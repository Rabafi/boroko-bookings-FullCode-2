import sys

file_path = r'c:\Users\Botswapelo Studios\Documents\Work\Boroko Bookings\src\renderer\src\components\AdminCentral.jsx'

with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# We want to replace the block around line 988 (0-indexed 987)
# From line 989 (index 988) to 1016 (index 1015)
start_index = 988
end_index = 1015

replacement = """              <Field label="License Period">
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Duration</label>
                      <select
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        value={duration}
                        onChange={e => {
                          const dur = e.target.value
                          setDuration(dur)
                          if (!dur) {
                            setForm({ ...form, expires_at: '' })
                            setSelectedPeriod(null)
                            return
                          }
                          const d = new Date()
                          if (dur === '3d') d.setDate(d.getDate() + 3)
                          else if (dur === '7d') d.setDate(d.getDate() + 7)
                          else if (dur === 'monthly') d.setMonth(d.getMonth() + 1)
                          else if (dur === 'quarterly') d.setMonth(d.getMonth() + 3)
                          else if (dur === 'half_year') d.setMonth(d.getMonth() + 6)
                          else if (dur === 'yearly') d.setFullYear(d.getFullYear() + 1)
                          
                          const val = d.toISOString().split('T')[0]
                          setForm({ ...form, expires_at: val })
                          setSelectedPeriod(dur === '3d' || dur === '7d' ? dur : 'paid')
                        }}
                      >
                        <option value="">— Select Duration —</option>
                        <option value="3d">Trial: 3 Days</option>
                        <option value="7d">Trial: 7 Days</option>
                        <option value="monthly">1 Month (Monthly)</option>
                        <option value="quarterly">3 Months (Quarterly)</option>
                        <option value="half_year">6 Months (Half-Year)</option>
                        <option value="yearly">1 Year (Yearly)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] text-gray-500 uppercase tracking-wider mb-1">Custom Expiry</label>
                      <input
                        type="date"
                        className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        value={form.expires_at}
                        onChange={e => {
                          setForm({ ...form, expires_at: e.target.value })
                          setSelectedPeriod(e.target.value ? 'paid' : null)
                          setDuration('')
                        }}
                      />
                    </div>
                  </div>
                  {form.expires_at && (
                    <div className="bg-gray-900/40 rounded-lg p-2 flex items-center justify-between border border-gray-700">
                      <p className="text-xs text-gray-300">
                        <span className="text-gray-500 uppercase text-[10px] mr-2">Expires</span>
                        {new Date(form.expires_at + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </p>
                      <button type="button" onClick={() => { setForm({ ...form, expires_at: '' }); setSelectedPeriod(null); setDuration('') }} className="text-red-400 hover:text-red-300 text-xs font-medium">Clear</button>
                    </div>
                  )}
                </div>
              </Field>
"""

# replace the lines
lines[start_index:end_index+1] = [replacement + '\\n']

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Success")
