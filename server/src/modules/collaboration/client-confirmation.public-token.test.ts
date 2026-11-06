import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareClientConfirmationTokenHashes,
  createClientConfirmationPublicToken,
  hashClientConfirmationPublicToken,
  isClientConfirmationPublicToken,
} from './collaboration.files.js'

test('public confirmation token has at least 192 bits of random material', () => {
  const first = createClientConfirmationPublicToken()
  const second = createClientConfirmationPublicToken()
  assert.equal(first.length, 32)
  assert.equal(isClientConfirmationPublicToken(first), true)
  assert.notEqual(first, second)
  assert.equal(hashClientConfirmationPublicToken(first).length, 64)
  assert.notEqual(hashClientConfirmationPublicToken(first), first)
})

test('public token digest comparison rejects malformed and different hashes', () => {
  const left = hashClientConfirmationPublicToken(createClientConfirmationPublicToken())
  const same = left.slice()
  const other = hashClientConfirmationPublicToken(createClientConfirmationPublicToken())
  assert.equal(compareClientConfirmationTokenHashes(left, same), true)
  assert.equal(compareClientConfirmationTokenHashes(left, other), false)
  assert.equal(compareClientConfirmationTokenHashes(left, 'invalid'), false)
})

test('public token input validation rejects numeric identifiers', () => {
  assert.equal(isClientConfirmationPublicToken('12345'), false)
  assert.throws(() => hashClientConfirmationPublicToken('12345'))
})
