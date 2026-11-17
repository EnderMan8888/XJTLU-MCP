export interface SavedCredentials { username: string; password: string }

export interface CredentialStatus {
  available: boolean
  saved: boolean
  username: string | null
  message: string
}

export interface CredentialActionResult { ok: boolean; message: string; status: CredentialStatus }

export interface AccountBridge {
  getStatus(): Promise<CredentialStatus>
  save(credentials: SavedCredentials): Promise<CredentialActionResult>
  forget(): Promise<CredentialActionResult>
  onChanged(listener: (status: CredentialStatus) => void): () => void
}
