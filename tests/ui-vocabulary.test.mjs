import assert from 'node:assert/strict'
import test from 'node:test'
import { getBusinessDisplayName, getUiVocabulary } from '../src/shared/uiVocabulary.js'
import { resolveModuleVisibility, MODULE_VISIBILITY_STATES } from '../src/shared/moduleCatalog.js'
import { getDesktopNavItems } from '../src/renderer/src/navigation/desktopNav.js'

test('hotel product vocabulary never says lodge', () => {
  const vocab = getUiVocabulary({ productId: 'hotel', propertyType: 'hotel' })
  assert.equal(vocab.noun, 'hotel')
  assert.equal(vocab.thisNoun, 'this hotel')
  assert.equal(vocab.yourNoun, 'your hotel')
  assert.equal(vocab.fullPropertyLabel, 'Full property')
  assert.doesNotMatch(vocab.noun, /lodge/i)
  assert.doesNotMatch(vocab.thisNoun, /lodge/i)
  assert.doesNotMatch(vocab.emailPlaceholder, /lodge/i)
})

test('hotel product resort uses resort language', () => {
  const vocab = getUiVocabulary({ productId: 'hotel', propertyType: 'resort' })
  assert.equal(vocab.noun, 'resort')
  assert.equal(vocab.nounTitle, 'Resort')
  assert.equal(vocab.thisNoun, 'this resort')
})

test('lodge product vocabulary keeps lodge for lodge type', () => {
  const vocab = getUiVocabulary({ productId: 'lodge-camp', propertyType: 'lodge' })
  assert.equal(vocab.noun, 'lodge')
  assert.equal(vocab.thisNoun, 'this lodge')
})

test('lodge product language follows setup property type', () => {
  const cases = [
    ['guest_house', 'guest house', 'Guest House', 'this guest house'],
    ['bnb', 'B&B', 'Bed & Breakfast', 'this B&B'],
    ['camp', 'camp', 'Camp', 'this camp'],
    ['motel', 'motel', 'Motel', 'this motel'],
    ['lodge', 'lodge', 'Lodge', 'this lodge']
  ]
  for (const [propertyType, noun, nounTitle, thisNoun] of cases) {
    const vocab = getUiVocabulary({ productId: 'lodge-camp', propertyType })
    assert.equal(vocab.noun, noun, propertyType)
    assert.equal(vocab.nounTitle, nounTitle, propertyType)
    assert.equal(vocab.thisNoun, thisNoun, propertyType)
    assert.equal(vocab.nameLabel, `${nounTitle} name`, propertyType)
  }
})

test('motel on lodge product does not use hotel vocabulary', () => {
  const vocab = getUiVocabulary({ productId: 'lodge-camp', propertyType: 'motel' })
  assert.equal(vocab.noun, 'motel')
  assert.doesNotMatch(vocab.noun, /hotel/i)
  assert.doesNotMatch(vocab.thisNoun, /hotel/i)
  assert.doesNotMatch(vocab.emailPlaceholder, /hotel/i)
})

test('display name prefers lodge_name field without exposing the key', () => {
  assert.equal(getBusinessDisplayName({ lodge_name: 'Cresta' }), 'Cresta')
  assert.equal(getBusinessDisplayName({ company_name: 'Co' }), 'Co')
})

test('room supplies are available for all accommodation property types on Pro', () => {
  for (const propertyType of ['guest_house', 'bnb', 'lodge', 'camp', 'motel', 'hotel', 'resort']) {
    assert.equal(
      resolveModuleVisibility('supplies', propertyType, 'Pro'),
      MODULE_VISIBILITY_STATES.visible,
      `supplies should be visible for ${propertyType}+Pro`
    )
  }

  const access = { allowedByRole: new Proxy({}, { get: () => true }) }
  for (const propertyType of ['guest_house', 'bnb', 'lodge', 'camp', 'motel']) {
    const items = getDesktopNavItems('lodge', access, propertyType, 'Pro', [], null, 'lodge-camp')
    assert.ok(
      items.some((item) => item.to === '/supplies' && item.isLocked !== true),
      `Room Supplies nav should be available for ${propertyType} on lodge-camp Pro`
    )
  }
})
