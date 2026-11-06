import type { Key } from '../crypto/keys.ts'
import { ProtocolError } from '../errors.ts'
import { RelayMessageSchema, type RelayMessage } from '../model/address.ts'

export interface StoredMessage {
  id: number
  date: string
  content: RelayMessage
}

/** The relay: encrypted mailboxes. State is held in memory. */
export class Mailboxes {
  private readonly boxes = new Map<Key, StoredMessage[]>()
  private nextId = 1

  constructor(private readonly clock: () => Date = () => new Date()) {}

  deposit(scan: Key, message: unknown): { id: number } {
    const parsed = RelayMessageSchema.safeParse(message)
    if (!parsed.success) throw new ProtocolError('INVALID_FORMAT', 'invalid relay message')
    const id = this.nextId++
    const stored = { id, date: this.clock().toISOString(), content: parsed.data }
    this.boxes.set(scan, [...(this.boxes.get(scan) ?? []), stored])
    return { id }
  }

  list(scan: Key): StoredMessage[] {
    return this.boxes.get(scan) ?? []
  }

  remove(scan: Key, id: number): void {
    this.boxes.set(
      scan,
      this.list(scan).filter((message) => message.id !== id),
    )
  }
}
