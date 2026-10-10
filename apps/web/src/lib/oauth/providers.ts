import { OAuthError } from './errors.js'

export type ProviderId = 'github' | 'google'

export const PROVIDER_IDS: readonly ProviderId[] = ['github', 'google']

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value)
}

/** What a provider tells us about a person, already validated and normalized. */
export type OAuthProfile = {
  /** The provider's stable id for this person. Unlike the email, it never changes. */
  providerAccountId: string
  /** Provider-verified, trimmed, lowercased. */
  email: string
  /** Never empty, at most NAME_MAX characters. */
  name: string
}

export type OAuthClient = { clientId: string; clientSecret: string }

type ProviderSpec = {
  label: string
  authorizeUrl: string
  tokenUrl: string
  scope: string
  envPrefix: string
  extraAuthorizeParams: Readonly<Record<string, string>>
}

export const PROVIDERS: Readonly<Record<ProviderId, ProviderSpec>> = {
  github: {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    // user:email is what grants access to /user/emails and its `verified` flags.
    scope: 'read:user user:email',
    envPrefix: 'GITHUB',
    extraAuthorizeParams: {},
  },
  google: {
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    envPrefix: 'GOOGLE',
    // Lets someone signed into several Google accounts pick one, instead of
    // silently getting whichever the browser chooses.
    extraAuthorizeParams: { prompt: 'select_account' },
  },
}

export const NAME_MAX = 80
const REQUEST_TIMEOUT_MS = 10_000

/** The configured credentials for a provider, or null if either half is missing. */
export function oauthClient(provider: ProviderId): OAuthClient | null {
  const prefix = PROVIDERS[provider].envPrefix
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim()
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** Providers with credentials set. Only these get a button on the login page. */
export function availableProviders(): ProviderId[] {
  return PROVIDER_IDS.filter((id) => oauthClient(id) !== null)
}

// Not invite-token's normalizeEmail: that one always returns a string, this one returns
// null for anything without an '@' so a provider profile with no usable email is refused.
function normalizeProviderEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return email.includes('@') ? email : null
}

function displayName(raw: unknown, fallback: string): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  return (name || fallback).slice(0, NAME_MAX)
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OAuthError('provider_error', `${what} was not an object`)
  }
  return value as Record<string, unknown>
}

export function githubProfile(user: unknown, emails: unknown): OAuthProfile {
  const u = asRecord(user, 'GitHub /user response')
  if ((typeof u.id !== 'number' && typeof u.id !== 'string') || typeof u.login !== 'string') {
    throw new OAuthError('provider_error', 'GitHub /user response is missing id or login')
  }
  if (!Array.isArray(emails)) {
    throw new OAuthError('provider_error', 'GitHub /user/emails response was not a list')
  }

  // Only the primary address, and only if GitHub has verified it. The profile's
  // public email is free text anyone can set to anything, and a verified
  // secondary address is not the one the person chose to be known by.
  const primary = emails
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .find((entry) => entry.primary === true && entry.verified === true && typeof entry.email === 'string')
  const email = primary ? normalizeProviderEmail(primary.email as string) : null
  if (!email) throw new OAuthError('no_verified_email', 'GitHub account has no verified primary email')

  return { providerAccountId: String(u.id), email, name: displayName(u.name, u.login) }
}

export function googleProfile(info: unknown): OAuthProfile {
  const i = asRecord(info, 'Google userinfo response')
  if (typeof i.sub !== 'string' || i.sub === '') {
    throw new OAuthError('provider_error', 'Google userinfo response is missing sub')
  }

  // Strictly the boolean true: a string "true" or a missing field is not proof.
  const email = i.email_verified === true && typeof i.email === 'string' ? normalizeProviderEmail(i.email) : null
  if (!email) throw new OAuthError('no_verified_email', 'Google account email is not verified')

  return { providerAccountId: i.sub, email, name: displayName(i.name, email.split('@')[0]!) }
}

async function getJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new OAuthError('provider_error', `${url} responded ${response.status}`)
  return response.json()
}

/** Trades an authorization code for an access token. Returns the token. */
export async function exchangeCode(
  provider: ProviderId,
  client: OAuthClient,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<string> {
  const json = await getJson(PROVIDERS[provider].tokenUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code_verifier: verifier,
    }),
  })

  // GitHub reports a failed exchange (a bad, expired or reused code) with HTTP 200
  // and an `error` field, so a successful status alone proves nothing.
  const token =
    typeof json === 'object' && json !== null ? (json as { access_token?: unknown }).access_token : undefined
  if (typeof token !== 'string' || token === '') {
    throw new OAuthError('provider_error', `${provider} token exchange returned no access_token`)
  }
  return token
}

const GITHUB_API_HEADERS = {
  accept: 'application/vnd.github+json',
  // GitHub's REST API rejects requests that carry no User-Agent.
  'user-agent': 'crdt-workspace',
  'x-github-api-version': '2022-11-28',
}

export async function fetchProfile(provider: ProviderId, accessToken: string): Promise<OAuthProfile> {
  if (provider === 'github') {
    const headers = { ...GITHUB_API_HEADERS, authorization: `Bearer ${accessToken}` }
    const [user, emails] = await Promise.all([
      getJson('https://api.github.com/user', { headers }),
      getJson('https://api.github.com/user/emails', { headers }),
    ])
    return githubProfile(user, emails)
  }

  const info = await getJson('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  return googleProfile(info)
}
