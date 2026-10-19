import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AuthContext } from '../../../src/renderer/src/app-context.jsx'
import { PropertyTypeSection } from '../../../src/renderer/src/components/Settings.jsx'
import {
  buildStorageKey,
  createTransitionController,
  loadStoredTransitionOp,
  OPERATION_STORAGE_VERSION
} from '../../../src/shared/propertyTransitionOperation.js'
import { getLodgingTypeOptions } from '../../../src/shared/propertyPresentation.js'

const LODGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_LODGE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const USER = 'user-settings-test'
const ARCHIVED_KEY = '11111111-1111-4111-8111-111111111111'
const CURRENT_KEY = '22222222-2222-4222-8222-222222222222'
const UPDATED_AT = '2026-10-01T00:00:00.000Z'

const settingsFor = (lodgeId, propertyType = 'lodge') => ({
  lodge_id: lodgeId,
  property_type: propertyType,
  business_type: propertyType,
  updated_at: UPDATED_AT,
  lodge_name: 'Mounted Recovery Lodge',
  operating_profile: { accommodation_mix: { rooms: 4, campsites: 1 } }
})

function seedArchivedAndCurrentOperations() {
  let nextKey = ARCHIVED_KEY
  const storage = window.localStorage
  const controller = createTransitionController({
    storage,
    scope: { lodgeId: LODGE, userId: USER },
    generateKey: () => { const key = nextKey; nextKey = CURRENT_KEY; return key }
  })
  controller.beginNew({
    targetType: 'camp', expectedPropertyType: 'lodge', expectedUpdatedAt: UPDATED_AT,
    reason: 'archived request still unresolved'
  })
  controller.archiveAndSupersede('test fixture: preserve unresolved operation')
  controller.beginNew({
    targetType: 'bnb', expectedPropertyType: 'lodge', expectedUpdatedAt: UPDATED_AT,
    reason: 'current unrelated operation'
  })
  return controller
}

function mountPropertySection(lodgeId = LODGE, propertyType = 'lodge', onCommitted = () => {}) {
  return render(
    <AuthContext.Provider value={{ user: { id: USER, email: 'operator@example.invalid' } }}>
      <PropertyTypeSection
        globalSettings={settingsFor(lodgeId, propertyType)}
        access={{}}
        canManage
        onCommitted={onCommitted}
      />
    </AuthContext.Provider>
  )
}

describe('F2 archived unresolved-operation recovery (production Settings component mounted)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    window.api = {
      settings: {
        previewPropertyTypeChange: vi.fn(async (targetType) => ({
          success: true,
          data: {
            expected_match: true,
            blockers: [],
            navigation: { notes: [] },
            accommodation_mix: { rooms: 4, sites: 1 },
            wording: {
              from_label: 'Current type',
              to_label: getLodgingTypeOptions().find((option) => option.value === targetType)?.label,
              unit_label_from: 'room',
              unit_label_to: 'unit',
              exclusive_use_from: 'Full lodge',
              exclusive_use_to: 'Exclusive use'
            }
          }
        })),
        commitPropertyTypeChange: vi.fn(async () => ({ success: true })),
        getPropertyTypeTransitionStatus: vi.fn(async (idempotencyKey) => ({
          success: true,
          lodge_id: LODGE,
          idempotency_key: idempotencyKey,
          target_type: 'camp',
          previous_type: 'lodge',
          data: { changed: true, target_type: 'camp', previous_type: 'lodge' }
        })),
        refreshSettingsFromServer: vi.fn(async () => ({ ok: true, settings: settingsFor(LODGE) }))
      }
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
    window.localStorage.clear()
    delete window.api
  })

  it('looks up the selected archived key in place and leaves the current operation untouched', async () => {
    seedArchivedAndCurrentOperations()
    mountPropertySection()

    expect(await screen.findByTestId('property-transition-pending')).toHaveTextContent('Pending operation')
    const archivedItem = screen.getByTestId('property-transition-archive-item')
    expect(archivedItem).toHaveAttribute('data-key', ARCHIVED_KEY)
    fireEvent.click(within(archivedItem).getByRole('button', { name: /check outcome/i }))

    expect(await screen.findByTestId('property-transition-archive-result')).toHaveTextContent(/Server reports a recorded outcome/)
    expect(window.api.settings.getPropertyTypeTransitionStatus).toHaveBeenCalledTimes(1)
    expect(window.api.settings.getPropertyTypeTransitionStatus).toHaveBeenCalledWith(ARCHIVED_KEY)
    expect(window.api.settings.commitPropertyTypeChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('property-transition-pending')).toHaveTextContent(CURRENT_KEY.slice(0, 8))
    expect(loadStoredTransitionOp(window.localStorage, buildStorageKey({ lodgeId: LODGE, userId: USER }))?.idempotencyKey).toBe(CURRENT_KEY)
  })

  it('drops a late archive result after switching A → B → A', async () => {
    seedArchivedAndCurrentOperations()
    let resolveStatus
    const pendingStatus = new Promise((resolve) => { resolveStatus = resolve })
    window.api.settings.getPropertyTypeTransitionStatus = vi.fn(() => pendingStatus)
    const mounted = mountPropertySection()
    const archivedItem = screen.getByTestId('property-transition-archive-item')
    fireEvent.click(within(archivedItem).getByRole('button', { name: /check outcome/i }))
    await waitFor(() => expect(window.api.settings.getPropertyTypeTransitionStatus).toHaveBeenCalledWith(ARCHIVED_KEY))

    mounted.rerender(
      <AuthContext.Provider value={{ user: { id: USER, email: 'operator@example.invalid' } }}>
        <PropertyTypeSection globalSettings={settingsFor(OTHER_LODGE)} access={{}} canManage onCommitted={() => {}} />
      </AuthContext.Provider>
    )
    mounted.rerender(
      <AuthContext.Provider value={{ user: { id: USER, email: 'operator@example.invalid' } }}>
        <PropertyTypeSection globalSettings={settingsFor(LODGE)} access={{}} canManage onCommitted={() => {}} />
      </AuthContext.Provider>
    )
    expect(await screen.findByTestId('property-transition-archive-item')).toHaveAttribute('data-key', ARCHIVED_KEY)
    resolveStatus({
      success: true,
      lodge_id: LODGE,
      idempotency_key: ARCHIVED_KEY,
      target_type: 'camp',
      previous_type: 'lodge',
      data: { changed: true, target_type: 'camp', previous_type: 'lodge' }
    })

    await waitFor(() => expect(screen.queryByTestId('property-transition-archive-result')).not.toBeInTheDocument())
    expect(screen.getByTestId('property-transition-pending')).toHaveTextContent(CURRENT_KEY.slice(0, 8))
    expect(loadStoredTransitionOp(window.localStorage, buildStorageKey({ lodgeId: LODGE, userId: USER }))?.idempotencyKey).toBe(CURRENT_KEY)
    expect(window.api.settings.commitPropertyTypeChange).not.toHaveBeenCalled()
  })

  it.each([
    ['guest_house', 'bnb'],
    ['bnb', 'motel'],
    ['lodge', 'guest_house'],
    ['camp', 'lodge'],
    ['motel', 'camp']
  ])('previews, confirms, and commits %s → %s through the mounted Settings flow', async (currentType, targetType) => {
    const currentLabel = getLodgingTypeOptions().find((option) => option.value === currentType).label
    const targetLabel = getLodgingTypeOptions().find((option) => option.value === targetType).label
    window.api.settings.commitPropertyTypeChange = vi.fn(async () => ({
      success: true,
      replayed: false,
      data: { changed: true, previous_type: currentType, target_type: targetType }
    }))
    window.api.settings.refreshSettingsFromServer = vi.fn(async () => ({ ok: true, settings: settingsFor(LODGE, targetType) }))
    const onCommitted = vi.fn()
    mountPropertySection(LODGE, currentType, onCommitted)

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(targetLabel) }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }))
    expect(await screen.findByText(`Impact preview — ${targetLabel}`)).toBeInTheDocument()
    expect(window.api.settings.previewPropertyTypeChange).toHaveBeenCalledWith(targetType)

    fireEvent.change(screen.getByPlaceholderText('e.g. Re-registered as a camp'), {
      target: { value: `verified transition from ${currentType}` }
    })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByPlaceholderText(targetLabel), { target: { value: targetLabel } })
    fireEvent.click(screen.getByRole('button', { name: `Commit change to ${targetLabel}` }))

    await waitFor(() => expect(window.api.settings.commitPropertyTypeChange).toHaveBeenCalledTimes(1))
    const payload = window.api.settings.commitPropertyTypeChange.mock.calls[0][0]
    expect(payload).toMatchObject({
      targetType,
      expectedPropertyType: currentType,
      expectedUpdatedAt: UPDATED_AT,
      reason: `verified transition from ${currentType}`
    })
    expect(payload.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(payload).not.toHaveProperty('amount_paid')
    expect(payload).not.toHaveProperty('payment_status')
    expect(await screen.findByText(`Property type is now ${targetLabel}. Settings and access are refreshing.`)).toBeInTheDocument()
    expect(window.api.settings.refreshSettingsFromServer).toHaveBeenCalledTimes(1)
    expect(onCommitted).toHaveBeenCalledTimes(1)
    expect(currentLabel).toBeTruthy()
  })

  it('does not call the RPC when durable local operation storage rejects the write', async () => {
    const targetLabel = getLodgingTypeOptions().find((option) => option.value === 'camp').label
    const originalSetItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (String(key).startsWith(`${OPERATION_STORAGE_VERSION}::`)) throw new DOMException('quota exceeded', 'QuotaExceededError')
      return originalSetItem.call(this, key, value)
    })
    mountPropertySection()

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(targetLabel) }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }))
    await screen.findByText(`Impact preview — ${targetLabel}`)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByPlaceholderText(targetLabel), { target: { value: targetLabel } })
    fireEvent.click(screen.getByRole('button', { name: `Commit change to ${targetLabel}` }))

    expect(await screen.findByText(/storage write failed/i)).toBeInTheDocument()
    expect(screen.getByText(/nothing was sent to the server/i)).toBeInTheDocument()
    expect(window.api.settings.commitPropertyTypeChange).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(buildStorageKey({ lodgeId: LODGE, userId: USER }))).toBeNull()
  })

  it('reopens the same timed-out key without resubmitting, then uses refresh-only recovery after a saved outcome', async () => {
    const targetLabel = getLodgingTypeOptions().find((option) => option.value === 'camp').label
    const timeout = new Error('socket timeout')
    timeout.code = 'ETIMEDOUT'
    window.api.settings.commitPropertyTypeChange = vi.fn().mockRejectedValue(timeout)
    mountPropertySection()

    fireEvent.click(screen.getByRole('radio', { name: new RegExp(targetLabel) }))
    fireEvent.click(screen.getByRole('button', { name: 'Preview impact' }))
    await screen.findByText(`Impact preview — ${targetLabel}`)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(screen.getByPlaceholderText(targetLabel), { target: { value: targetLabel } })
    fireEvent.click(screen.getByRole('button', { name: `Commit change to ${targetLabel}` }))
    expect(await screen.findByText('Property-type change could not complete')).toBeInTheDocument()
    expect(screen.getByTestId('property-transition-pending')).toBeInTheDocument()

    const beforeReopen = screen.getByText(/Operation key:/).textContent
    const operationKey = beforeReopen.match(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i)?.[0]
    expect(operationKey).toBeTruthy()
    expect(loadStoredTransitionOp(window.localStorage, buildStorageKey({ lodgeId: LODGE, userId: USER }))?.idempotencyKey).toBe(operationKey)

    cleanup()
    window.api.settings.commitPropertyTypeChange.mockClear()
    mountPropertySection()
    expect(await screen.findByTestId('property-transition-pending')).toHaveTextContent(operationKey.slice(0, 8))
    expect(screen.getByText(/Operation key:/)).toHaveTextContent(operationKey)
    expect(window.api.settings.commitPropertyTypeChange).not.toHaveBeenCalled()

    window.api.settings.commitPropertyTypeChange.mockResolvedValue({
      success: true,
      data: { changed: true, previous_type: 'lodge', target_type: 'camp' }
    })
    window.api.settings.refreshSettingsFromServer
      .mockResolvedValueOnce({ ok: false, reason: 'offline-after-save' })
      .mockResolvedValue({ ok: true, settings: settingsFor(LODGE, 'camp') })
    fireEvent.click(screen.getByRole('button', { name: 'Retry original operation (same key)' }))
    await screen.findByTestId('property-transition-refresh-warning')
    expect(window.api.settings.commitPropertyTypeChange).toHaveBeenCalledTimes(1)
    expect(window.api.settings.commitPropertyTypeChange.mock.calls[0][0].idempotencyKey).toBe(operationKey)

    fireEvent.click(screen.getByTestId('property-transition-refresh-retry'))
    expect(await screen.findByText(/Settings and access refreshed from the server — no new submission was made/i)).toBeInTheDocument()
    expect(window.api.settings.commitPropertyTypeChange).toHaveBeenCalledTimes(1)
    expect(window.api.settings.refreshSettingsFromServer).toHaveBeenCalledTimes(2)
  })
})
