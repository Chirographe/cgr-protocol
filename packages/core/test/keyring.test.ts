import { describe, expect, it } from 'vitest'
import { MemoryKeyVault, generateSigner, sealedKeyring, verifySignature } from '../src/index.ts'
import { decodeBase64Url } from '../src/encoding/base64url.ts'

const options = { cost: 4 }
const message = new Uint8Array([1, 2, 3])

describe('sealed keyring', () => {
  it('finds the same key again', async () => {
    const vault = new MemoryKeyVault()
    const first = await sealedKeyring(vault, 'secret', options)
    const again = await sealedKeyring(vault, 'secret', options)
    expect(again.current().key).toBe(first.current().key)
    const signature = await again.current().sign(message)
    expect(verifySignature(first.current().key, signature, message)).toBe(true)
  })

  it('never stores the secret in clear', async () => {
    const vault = new MemoryKeyVault()
    const keyring = await sealedKeyring(vault, 'secret', options)
    const stored = (await vault.load()) as string
    const { data } = JSON.parse(stored) as { data: string }
    expect(stored).not.toContain(keyring.current().key)
    expect(new TextDecoder().decode(decodeBase64Url(data))).not.toContain('secret')
  })

  it('refuses a wrong password', async () => {
    const vault = new MemoryKeyVault()
    await sealedKeyring(vault, 'secret', options)
    await expect(sealedKeyring(vault, 'wrong', options)).rejects.toThrow('wrong password')
  })

  it('keeps a prepared key across a crash, then activates it', async () => {
    const vault = new MemoryKeyVault()
    const keyring = await sealedKeyring(vault, 'secret', options)
    const old = keyring.current().key
    const next = await keyring.next()
    expect(keyring.current().key).toBe(old)
    expect((await sealedKeyring(vault, 'secret', options)).current().key).toBe(old)

    await keyring.activate(next)
    expect(keyring.current().key).toBe(next.key)
    expect((await sealedKeyring(vault, 'secret', options)).current().key).toBe(next.key)
  })

  it('refuses a key it did not prepare', async () => {
    const keyring = await sealedKeyring(new MemoryKeyVault(), 'secret', options)
    await expect(keyring.activate(generateSigner())).rejects.toThrow('not prepared')
  })
})
