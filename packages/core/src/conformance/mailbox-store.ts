import type { MailboxStore } from '../guardian/mailbox.ts'
import {
  DATE,
  KEY_A,
  KEY_B,
  casesOn,
  check,
  same,
  type ConformanceCase,
  type Open,
} from './support.ts'

const relayMessage = (ciphertext: string) => ({ ephemeral: KEY_A, ciphertext })

export function mailboxStoreCases(open: Open<MailboxStore>): ConformanceCase[] {
  const inStore = casesOn(open)
  return [
    inStore('keeps messages per mailbox, oldest first', async (store) => {
      const first = await store.add(KEY_A, DATE, relayMessage('AAAA'))
      const second = await store.add(KEY_A, DATE, relayMessage('BBBB'))
      const other = await store.add(KEY_B, DATE, relayMessage('CCCC'))
      check(new Set([first, second, other]).size === 3, 'ids are not unique')
      same(
        await store.list(KEY_A),
        [
          { id: first, date: DATE, content: relayMessage('AAAA') },
          { id: second, date: DATE, content: relayMessage('BBBB') },
        ],
        'wrong mailbox content',
      )
    }),

    inStore('removes a message from its own mailbox only', async (store) => {
      const id = await store.add(KEY_A, DATE, relayMessage('AAAA'))
      await store.remove(KEY_B, id)
      check((await store.list(KEY_A)).length === 1, 'a message left through another mailbox')
      await store.remove(KEY_A, id)
      check((await store.list(KEY_A)).length === 0, 'a message was not removed')
      await store.remove(KEY_A, id)
    }),
  ]
}
