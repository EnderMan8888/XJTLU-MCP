import type { CredentialStore } from '../infrastructure/credential-store.ts'
import type { CredentialStatus, SavedCredentials } from '../shared/credentials.ts'

export interface AccountConsumer {
  cancelAccountAutomation(): Promise<void>
  accountChanged(previous: CredentialStatus, current: CredentialStatus): void
}

// Campus-wide account ownership. School modules consume the account but do not
// own, delete, or return its password to the renderer.
export class AccountService {
  private store: CredentialStore
  private publish: (status: CredentialStatus) => void
  private consumers = new Set<AccountConsumer>()
  private tail: Promise<unknown> = Promise.resolve()

  constructor(store: CredentialStore, publish: (status: CredentialStatus) => void) { this.store = store; this.publish = publish }
  subscribe(consumer: AccountConsumer): () => void { this.consumers.add(consumer); return () => this.consumers.delete(consumer) }
  read(): Promise<SavedCredentials | null> { return this.store.read() }
  status(): Promise<CredentialStatus> { return this.store.status() }

  private change(operation: () => Promise<void>): Promise<void> {
    const result = this.tail.then(async () => {
      const previous = await this.store.status()
      await Promise.all([...this.consumers].map((consumer) => consumer.cancelAccountAutomation()))
      await operation()
      const current = await this.store.status()
      this.publish(current)
      for (const consumer of this.consumers) consumer.accountChanged(previous, current)
    })
    this.tail = result.catch(() => {})
    return result
  }

  save(input: unknown): Promise<void> { return this.change(() => this.store.save(input)) }
  forget(): Promise<void> { return this.change(() => this.store.forget()) }
}
