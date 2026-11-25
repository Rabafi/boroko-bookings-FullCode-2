    (function () {
      var SUPABASE_URL = 'https://oicgpknsmtvcsjacymum.supabase.co'
      var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY2dwa25zbXR2Y3NqYWN5bXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2OTM1MTEsImV4cCI6MjA4OTI2OTUxMX0.WbC5C1QaVeNaTbTG0_xdcsUlK3BoA8onWC607B_uGlY'
      var EDGE_FUNCTION_URL = 'https://oicgpknsmtvcsjacymum.supabase.co/functions/v1/auth-master-admin'
      var supabase = null
      var allLeads = []
      var currentUser = null

      var loginView = document.getElementById('login-view')
      var dashboardView = document.getElementById('dashboard-view')
      var loginForm = document.getElementById('login-form')
      var loginEmail = document.getElementById('login-email')
      var loginPassword = document.getElementById('login-password')
      var loginError = document.getElementById('login-error')
      var logoutBtn = document.getElementById('logout-btn')
      var userEmail = document.getElementById('user-email')
      var leadsTbody = document.getElementById('leads-tbody')
      var loadingState = document.getElementById('loading-state')
      var errorState = document.getElementById('error-state')
      var tableWrap = document.getElementById('table-wrap')
      var emptyState = document.getElementById('empty-state')
      var statusFilter = document.getElementById('status-filter')
      var searchInput = document.getElementById('search-input')
      var exportBtn = document.getElementById('export-btn')
      var exportCount = document.getElementById('export-count')
      var togglePasswordBtn = document.getElementById('toggle-password')
      var loginPasswordInput = document.getElementById('login-password')

      function initSupabase() {
        if (typeof supabaseClient !== 'undefined') {
          supabase = supabaseClient.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: true, storageKey: 'boroko-crm-auth' }
          })
        } else {
          supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: { persistSession: true, storageKey: 'boroko-crm-auth' }
          })
        }
      }

      function showView(view) {
        loginView.style.display = view === 'login' ? 'block' : 'none'
        dashboardView.style.display = view === 'dashboard' ? 'block' : 'none'
      }

      function formatDate(iso) {
        if (!iso) return '-'
        var d = new Date(iso)
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      }

      function statusClass(status) {
        return 'status-' + (status || 'new')
      }

      function escapeHtml(str) {
        if (!str) return ''
        var d = document.createElement('div')
        d.textContent = str
        return d.innerHTML
      }

      function renderLeads(leads) {
        allLeads = leads
        var filtered = filterLeads(leads)
        leadsTbody.innerHTML = ''

        if (filtered.length === 0) {
          tableWrap.style.display = 'none'
          emptyState.style.display = 'block'
          exportCount.textContent = '0 leads'
          updateStats(leads)
          return
        }

        tableWrap.style.display = 'block'
        emptyState.style.display = 'none'
        exportCount.textContent = filtered.length + ' of ' + leads.length + ' leads'

        filtered.forEach(function (lead) {
          var tr = document.createElement('tr')
          tr.innerHTML = '' +
            '<td>' + escapeHtml(formatDate(lead.created_at)) + '</td>' +
            '<td><strong>' + escapeHtml(lead.lodge_name || '-') + '</strong></td>' +
            '<td>' + escapeHtml(lead.contact_name || '-') + '</td>' +
            '<td>' + escapeHtml(lead.email || '-') + '</td>' +
            '<td>' + escapeHtml(lead.phone || '-') + '</td>' +
            '<td>' + escapeHtml(lead.interest || '-') + '</td>' +
            '<td><div class="notes-preview" title="' + escapeHtml(lead.notes || '') + '">' + escapeHtml(lead.notes || '-') + '</div></td>' +
            '<td>' +
              '<select data-id="' + escapeHtml(String(lead.id)) + '">' +
                '<option value="new"' + (lead.status === 'new' ? ' selected' : '') + '>New</option>' +
                '<option value="contacted"' + (lead.status === 'contacted' ? ' selected' : '') + '>Contacted</option>' +
                '<option value="qualified"' + (lead.status === 'qualified' ? ' selected' : '') + '>Qualified</option>' +
                '<option value="converted"' + (lead.status === 'converted' ? ' selected' : '') + '>Converted</option>' +
                '<option value="lost"' + (lead.status === 'lost' ? ' selected' : '') + '>Lost</option>' +
              '</select>' +
            '</td>'
          leadsTbody.appendChild(tr)
        })

        updateStats(leads)
        attachStatusHandlers()
      }

      function updateStats(leads) {
        document.getElementById('stat-total').textContent = leads.length
        document.getElementById('stat-new').textContent = leads.filter(function (l) { return l.status === 'new' || !l.status }).length
        document.getElementById('stat-contacted').textContent = leads.filter(function (l) { return l.status === 'contacted' }).length
        document.getElementById('stat-converted').textContent = leads.filter(function (l) { return l.status === 'converted' }).length
      }

      function filterLeads(leads) {
        var statusValue = statusFilter.value
        var searchValue = (searchInput.value || '').toLowerCase().trim()
        return leads.filter(function (lead) {
          var statusMatch = !statusValue || (lead.status || 'new') === statusValue
          var haystack = [
            lead.lodge_name,
            lead.contact_name,
            lead.email,
            lead.phone,
            lead.notes,
            lead.interest
          ].join(' ').toLowerCase()
          var searchMatch = !searchValue || haystack.indexOf(searchValue) !== -1
          return statusMatch && searchMatch
        })
      }

      async function loadLeads() {
        loadingState.style.display = 'block'
        errorState.style.display = 'none'
        tableWrap.style.display = 'none'
        emptyState.style.display = 'none'

        var response = await supabase
          .from('marketing_leads')
          .select('*')
          .order('created_at', { ascending: false })

        loadingState.style.display = 'none'

        if (response.error) {
          errorState.style.display = 'block'
          errorState.textContent = response.error.message
          return
        }

        renderLeads(response.data || [])
      }

      function attachStatusHandlers() {
        leadsTbody.querySelectorAll('select[data-id]').forEach(function (select) {
          select.addEventListener('change', async function () {
            var id = select.getAttribute('data-id')
            var status = select.value
            select.disabled = true
            var response = await supabase.from('marketing_leads').update({ status: status }).eq('id', id)
            select.disabled = false
            if (response.error) {
              alert(response.error.message)
              await loadLeads()
              return
            }
            await loadLeads()
          })
        })
      }

      function exportCsv() {
        var rows = filterLeads(allLeads)
        var headers = ['date', 'lodge_name', 'contact_name', 'email', 'phone', 'interest', 'notes', 'status']
        var csv = [headers.join(',')]
        rows.forEach(function (lead) {
          csv.push(headers.map(function (header) {
            var value = lead[header] || ''
            return '"' + String(value).replace(/"/g, '""') + '"'
          }).join(','))
        })
        var blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' })
        var url = URL.createObjectURL(blob)
        var a = document.createElement('a')
        a.href = url
        a.download = 'tsa-bonno-leads.csv'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }

      async function signIn(email, password) {
        loginError.classList.remove('is-visible')
        loginError.textContent = ''

        try {
          var res = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: password })
          })
          var payload = await res.json()
          if (!res.ok || !payload.access_token) throw new Error(payload.error || 'Invalid credentials')

          var signInResponse = await supabase.auth.setSession({
            access_token: payload.access_token,
            refresh_token: payload.refresh_token
          })

          if (signInResponse.error) throw signInResponse.error

          currentUser = signInResponse.data.user
          userEmail.textContent = currentUser.email || email
          showView('dashboard')
          await loadLeads()
        } catch (err) {
          loginError.textContent = err.message || 'Unable to sign in'
          loginError.classList.add('is-visible')
        }
      }

      async function checkSession() {
        var sessionResponse = await supabase.auth.getSession()
        var session = sessionResponse.data && sessionResponse.data.session
        if (session && session.user) {
          currentUser = session.user
          userEmail.textContent = currentUser.email || ''
          showView('dashboard')
          await loadLeads()
        } else {
          showView('login')
        }
      }

      loginForm.addEventListener('submit', function (event) {
        event.preventDefault()
        signIn(loginEmail.value.trim(), loginPassword.value)
      })

      statusFilter.addEventListener('change', function () {
        renderLeads(allLeads)
      })

      searchInput.addEventListener('input', function () {
        renderLeads(allLeads)
      })

      exportBtn.addEventListener('click', exportCsv)

      logoutBtn.addEventListener('click', async function () {
        await supabase.auth.signOut()
        currentUser = null
        showView('login')
      })

      if (togglePasswordBtn && loginPasswordInput) {
        togglePasswordBtn.addEventListener('click', function () {
          var isPassword = loginPasswordInput.type === 'password'
          loginPasswordInput.type = isPassword ? 'text' : 'password'
          togglePasswordBtn.textContent = isPassword ? '🙈' : '👁'
          togglePasswordBtn.title = isPassword ? 'Hide password' : 'Show password'
        })
      }

      initSupabase()
      checkSession()
    })()
    