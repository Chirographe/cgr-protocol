import type { Key } from '../crypto/keys.ts'
import { ProtocolError } from '../errors.ts'
import { RelayMessageSchema, type RelayMessage } from '../model/address.ts'

export interface StoredMessage {
  id: number
  date: string
  content: RelayMessage
}

/** Durable storage of the relay. */
export interface MailboxStore {
  /** Returns an id unique among all mailboxes. */
  add(scan: Key, date: string, content: RelayMessage): Promise<number>
  /** Oldest first. */
  list(scan: Key): Promise<StoredMessage[]>
  remove(scan: Key, id: number): Promise<void>
}

/** Volatile store for tests and tools. Not durable. */
export class MemoryMailboxStore implements MailboxStore {
  private readonly boxes = new Map<Key, StoredMessage[]>()
  private nextId = 1

  add(scan: Key, date: string, content: RelayMessage): Promise<number> {
    const id = this.nextId++
    this.boxes.set(scan, [...(this.boxes.get(scan) ?? []), { id, date, content }])
    return Promise.resolve(id)
  }

  list(scan: Key): Promise<StoredMessage[]> {
    return Promise.resolve(this.boxes.get(scan) ?? [])
  }

  remove(scan: Key, id: number): Promise<void> {
    const kept = (this.boxes.get(scan) ?? []).filter((message) => message.id !== id)
    this.boxes.set(scan, kept)
    return Promise.resolve()
  }
}

/** The relay: encrypted mailboxes. */
export class Mailboxes {
  constructor(
    private readonly store: MailboxStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async deposit(scan: Key, message: unknown): Promise<{ id: number }> {
    const parsed = RelayMessageSchema.safeParse(message)
    if (!parsed.success) throw new ProtocolError('INVALID_FORMAT', 'invalid relay message')
    return { id: await this.store.add(scan, this.clock().toISOString(), parsed.data) }
  }

  list(scan: Key): Promise<StoredMessage[]> {
    return this.store.list(scan)
  }

  remove(scan: Key, id: number): Promise<void> {
    return this.store.remove(scan, id)
  }
}
