import {
  closeOnSignal,
  readGuardianConfig,
  rotateGuardianKey,
  startGuardian,
} from '@chirographe/server'
import { openGuardianStorage } from '@chirographe/storage-sqlite'

// The only line that knows the storage technology.
const storage = openGuardianStorage(process.env.DATA_PATH ?? './data')

const config = readGuardianConfig(process.env)
if (process.argv[2] === 'rotate') {
  await rotateGuardianKey(config, storage)
} else {
  const { app } = await startGuardian(config, storage)
  closeOnSignal(app)
}
