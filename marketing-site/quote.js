    ;(function () {
      // Packages page: carry the Hotel add-on builder selection into the quotation flow.
      var hotelBuilder = document.querySelector('[data-hotel-addon-builder]');
      var handoff = document.getElementById('hotel-quote-handoff');
      if (hotelBuilder && handoff) {
        handoff.addEventListener('click', function (e) {
          e.preventDefault();
          var keys = [];
          hotelBuilder.querySelectorAll('input[type="checkbox"]:checked').forEach(function (cb) {
            if (cb.value) keys.push(cb.value);
          });
          var enterprisePage = (window.TSA_SITE && window.TSA_SITE.pages && window.TSA_SITE.pages.enterprise) || './enterprise.html';
          window.location.href = keys.length
            ? enterprisePage + '?addons=' + keys.join(',')
            : enterprisePage;
        });
      }

      var form = document.getElementById('enterprise-quote-form');
      if (!form) return;
      var submitBtn = document.getElementById('submit-btn');
      var errorEl = document.getElementById('form-error');
      var successEl = document.getElementById('form-success');
      var formContainer = document.getElementById('form-container');
      var quoteRef = document.getElementById('quote-ref');
      var summaryAddons = document.getElementById('summary-addons');
      var requestedPlan = document.getElementById('requested-plan');
      var trialStatus = document.getElementById('trial-status');
      var planPrices = {
        Hotel: { annual: null, setup: null, internalPlan: 'Enterprise' }
      };
      var addonPrices = {
        custom_website: { annual: 12000, setup: 8000 },
        payment_gateway: { annual: 9000, setup: 6000 },
        channel_manager: { annual: 15000, setup: 10000 },
        guest_portal: { annual: 9000, setup: 5000 },
        multi_property: { annual: 18000, setup: 12000 },
        advanced_rates: { annual: 12000, setup: 5000 },
        multi_outlet_pos: { annual: 9000, setup: 4000 }
      };
      var addonLabels = {
        custom_website: 'Custom Direct Booking Website',
        payment_gateway: 'Online Payment Gateway',
        channel_manager: 'Channel Manager',
        guest_portal: 'Guest Portal',
        multi_property: 'Multi-Property Dashboard',
        advanced_rates: 'Advanced Rate Engine',
        multi_outlet_pos: 'Multi-Outlet POS Pro'
      };

      function money(value) {
        return typeof value === 'number' ? 'P' + value.toLocaleString('en-BW') + '.00' : 'To be confirmed';
      }

      function selectedAddons() {
        var checkedAddons = [];
        document.querySelectorAll('#addon-grid input[type="checkbox"]:checked').forEach(function (cb) {
          checkedAddons.push(cb.value);
        });
        return checkedAddons;
      }

      function buildPricingSnapshot() {
        var plan = requestedPlan.value || 'Hotel';
        var trialAlreadyUsed = trialStatus.value === 'used';
        var trialEligible = !trialAlreadyUsed;
        var annual = planPrices[plan] ? planPrices[plan].annual : null;
        var setup = planPrices[plan] && typeof planPrices[plan].setup === 'number' ? planPrices[plan].setup : null;
        var addons = {};
        selectedAddons().forEach(function (key) {
          var addonPrice = addonPrices[key] || { annual: 0, setup: 0 };
          addons[key] = {
            label: addonLabels[key] || key,
            annual: addonPrice.annual,
            setup: addonPrice.setup,
            pricing_model: 'published'
          };
          if (annual !== null) annual += addonPrice.annual;
          if (setup !== null) setup += addonPrice.setup;
        });
        return {
          plan: planPrices[plan]?.internalPlan || 'Enterprise',
          package_label: 'Hotel',
          plan_price: planPrices[plan] || planPrices.Hotel,
          addons: addons,
          room_count: document.getElementById('room-count').value ? Number(document.getElementById('room-count').value) : null,
          user_count: document.getElementById('user-count').value ? Number(document.getElementById('user-count').value) : null,
          currency: 'BWP',
          currency_symbol: 'P',
          annual_subtotal: annual,
          setup_total: setup,
          total_due_after_trial: annual,
          total_due_now: trialEligible ? setup : annual,
          trial: {
            eligible: trialEligible,
            already_used: trialAlreadyUsed,
            days: 30,
            policy: 'One 30-day free trial is available once per property. If this property has already used its trial, the quoted paid package applies immediately after approval.'
          },
          note: 'Hotel pricing is confirmed by quotation. Payment is manual and activation happens only after Tsa Bonno approves payment proof.'
        };
      }

      function buildQuotePayload(quoteNumber, payload, pricing) {
        return {
          document_type: 'quote',
          document_number: quoteNumber,
          issued_at: new Date().toISOString(),
          status: 'quoted',
          customer: {
            company_name: payload.p_company_name,
            property_name: payload.p_property_name,
            contact_name: payload.p_contact_name,
            contact_email: payload.p_contact_email,
            contact_phone: payload.p_contact_phone,
            country: payload.p_country
          },
          package: {
            current_plan: null,
            requested_plan: payload.p_requested_plan,
            package_name: 'Hotel',
            requested_addons: Array.isArray(payload.p_requested_addons) ? payload.p_requested_addons : [],
            room_count: payload.p_room_count,
            user_count: payload.p_user_count,
            expected_monthly_bookings: payload.p_expected_monthly_bookings
          },
          pricing: pricing,
          totals: {
            currency: 'BWP',
            recurring_amount: pricing.annual_subtotal,
            setup_amount: pricing.setup_total,
            total_due_now: pricing.total_due_now
          },
          notes: pricing.note,
          trial_policy: pricing.trial,
          payment_instructions: 'Manual payment only. Pay by bank transfer/mobile money using the quote number as reference, then send proof of payment to Tsa Bonno for review.'
        };
      }

      function downloadQuoteHtml(quotePayload) {
        var addonRows = (quotePayload.package.requested_addons || []).map(function (key) {
          var addonPrice = addonPrices[key] || { annual: 0, setup: 0 };
          return '<li>' + (addonLabels[key] || key) + ' - ' + money(addonPrice.annual) + '/year' + (addonPrice.setup ? ' + ' + money(addonPrice.setup) + ' setup' : '') + '</li>';
        }).join('');
        var html = '<!doctype html><html><head><meta charset="utf-8"><title>' + quotePayload.document_number + '</title>' +
          '<style>body{font-family:Arial,sans-serif;margin:40px;color:#17231d}h1{color:#174c3a}.box{border:1px solid #ddd;padding:16px;margin:14px 0}.muted{color:#667}</style></head><body>' +
          '<h1>Tsa Bonno HospitalityOS Subscription Quotation</h1>' +
          '<p><strong>Quote:</strong> ' + quotePayload.document_number + '</p>' +
          '<p><strong>Property:</strong> ' + quotePayload.customer.property_name + '</p>' +
          '<p><strong>Contact:</strong> ' + quotePayload.customer.contact_name + ' | ' + quotePayload.customer.contact_email + ' | ' + quotePayload.customer.contact_phone + '</p>' +
          '<div class="box"><h2>Package</h2><p><strong>' + (quotePayload.package.package_name || 'Hotel') + '</strong></p>' +
          '<p>Recurring annual: ' + money(quotePayload.pricing.totals?.recurring_annual ?? quotePayload.pricing.annual_subtotal) + '</p>' +
          '<p>One-time amount: ' + money(quotePayload.pricing.totals?.one_time_total ?? quotePayload.pricing.setup_total) + '</p>' +
          '<p>Total due now: ' + money(quotePayload.pricing.totals?.total_due_now ?? quotePayload.pricing.total_due_now) + '</p>' +
          '<p>Price basis: initial Hotel Core purchase; recurring add-ons are shown separately where applicable.</p></div>' +
          (addonRows ? '<div class="box"><h2>Add-ons</h2><ul>' + addonRows + '</ul></div>' : '') +
          '<div class="box"><h2>Payment</h2><p>' + quotePayload.payment_instructions + '</p></div>' +
          '<p class="muted">' + quotePayload.notes + '</p></body></html>';
        var blob = new Blob([html], { type: 'text/html' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = quotePayload.document_number + '.html';
        a.click();
        URL.revokeObjectURL(url);
      }

      async function downloadQuotePdf(downloadToken, quotePayload) {
        if (downloadToken) {
          try {
            var response = await fetch('/api/quote-download?token=' + encodeURIComponent(downloadToken), { cache: 'no-store' });
            if (response.ok) {
              var blob = await response.blob();
              var url = URL.createObjectURL(blob);
              var anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = (quotePayload.document_number || 'tsa-bonno-quote') + '.pdf';
              anchor.click();
              URL.revokeObjectURL(url);
              return;
            }
          } catch (_) {}
        }
        downloadQuoteHtml(quotePayload);
      }

      var initialPlan = new URLSearchParams(window.location.search).get('plan');
      if (initialPlan && planPrices[initialPlan]) requestedPlan.value = initialPlan;

      // Summary bar
      function updateSummary() {
        var pricing = buildPricingSnapshot();
        var checked = document.querySelectorAll('#addon-grid input[type="checkbox"]:checked');
        var lines = '<div class="summary-line"><span class="summary-line-label">Annual</span><span>' + money(pricing.annual_subtotal) + '</span></div>';
        lines += '<div class="summary-line"><span class="summary-line-label">Due now</span><span>' + money(pricing.total_due_now) + '</span></div>';
        lines += '<div class="summary-line"><span class="summary-line-label">Trial</span><span>' + (pricing.trial.eligible ? '30 days' : 'Not included') + '</span></div>';
        if (checked.length === 0) {
          summaryAddons.innerHTML = lines + '<p style="font-size:12px;color:var(--ink-soft);margin-top:8px;">No add-ons selected yet.</p>';
          return;
        }
        var html = lines;
        checked.forEach(function (cb) {
          var card = cb.closest('.addon-card');
          var title = card ? card.querySelector('h4').textContent : cb.value;
          html += '<div class="summary-addon">+ ' + title + ' (quote confirmed)</div>';
        });
        summaryAddons.innerHTML = html;
      }

      document.querySelectorAll('#addon-grid input[type="checkbox"]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          var card = cb.closest('.addon-card');
          if (card) card.classList.toggle('selected', cb.checked);
          updateSummary();
        });
      });
      requestedPlan.addEventListener('change', updateSummary);
      trialStatus.addEventListener('change', updateSummary);

      // Pre-check add-ons carried from the packages.html builder via ?addons=key,key
      var addonsParam = new URLSearchParams(window.location.search).get('addons');
      if (addonsParam) {
        var wanted = addonsParam.split(',').map(function (s) { return s.trim() }).filter(Boolean);
        document.querySelectorAll('#addon-grid input[type="checkbox"]').forEach(function (cb) {
          if (wanted.indexOf(cb.value) !== -1) {
            cb.checked = true;
            cb.dispatchEvent(new Event('change'));
          }
        });
      }
      updateSummary();

      // Form submit
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        errorEl.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        var checkedAddons = selectedAddons();
        var pricingSnapshot = buildPricingSnapshot();

        var payload = {
          p_company_name: document.getElementById('property-name').value.trim(),
          p_property_name: document.getElementById('property-name').value.trim(),
          p_contact_name: document.getElementById('contact-name').value.trim(),
          p_contact_email: document.getElementById('contact-email').value.trim(),
          p_contact_phone: document.getElementById('contact-phone').value.trim(),
          p_country: document.getElementById('country').value.trim(),
          p_property_type: document.getElementById('property-type').value,
          p_requested_plan: planPrices[requestedPlan.value]?.internalPlan || 'Enterprise',
          p_requested_plan_display: 'Hotel',
          p_requested_addons: checkedAddons,
          p_room_count: document.getElementById('room-count').value ? Number(document.getElementById('room-count').value) : null,
          p_user_count: document.getElementById('user-count').value ? Number(document.getElementById('user-count').value) : null,
          p_expected_monthly_bookings: document.getElementById('expected-bookings').value ? Number(document.getElementById('expected-bookings').value) : null,
          p_notes: [
            document.getElementById('notes').value.trim(),
            pricingSnapshot.trial.already_used ? 'Client indicated this property has already used its free trial.' : 'Client indicated this property has not used its free trial.'
          ].filter(Boolean).join('\n'),
          p_pricing_snapshot: pricingSnapshot
        };
        var preQuoteNumber = 'QT-' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17);
        payload.p_quote_payload = buildQuotePayload(preQuoteNumber, payload, pricingSnapshot);

        try {
          // The legacy submit_public_subscription_request RPC remains deployed for
          // old clients, but this page uses the product-aware authoritative RPC.
          var authorityPayload = {
            p_selection: {
              product_id: 'hotel',
              commercial_package_key: 'hotel_core',
              selected_addon_keys: checkedAddons,
              property_type: payload.p_property_type
            },
            p_customer: {
              company_name: payload.p_company_name,
              property_name: payload.p_property_name,
              contact_name: payload.p_contact_name,
              contact_email: payload.p_contact_email,
              contact_phone: payload.p_contact_phone,
              country: payload.p_country,
              notes: payload.p_notes
            }
          };
          var res = await fetch('https://oicgpknsmtvcsjacymum.supabase.co/rest/v1/rpc/submit_public_commercial_quote_request', {
            method: 'POST',
            headers: {
              'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY2dwa25zbXR2Y3NqYWN5bXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2OTM1MTEsImV4cCI6MjA4OTI2OTUxMX0.WbC5C1QaVeNaTbTG0_xdcsUlK3BoA8onWC607B_uGlY',
              'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9pY2dwa25zbXR2Y3NqYWN5bXVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2OTM1MTEsImV4cCI6MjA4OTI2OTUxMX0.WbC5C1QaVeNaTbTG0_xdcsUlK3BoA8onWC607B_uGlY',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(authorityPayload)
          });

          var data = await res.json();
          if (!res.ok || data?.success === false) {
            throw new Error(data?.error || data?.message || 'Submission failed');
          }
          var finalQuote = buildQuotePayload(data.quote_number || preQuoteNumber, payload, pricingSnapshot);
          if (data.quote_payload) {
            finalQuote.pricing = data.quote_payload;
            finalQuote.package.package_name = data.quote_payload.package_label || 'Hotel Core';
            finalQuote.totals = {
              currency: data.quote_payload.currency || 'BWP',
              recurring_amount: data.quote_payload.totals?.recurring_annual ?? null,
              setup_amount: data.quote_payload.totals?.one_time_total ?? null,
              total_due_now: data.quote_payload.totals?.total_due_now ?? null
            };
            finalQuote.download_token = data.download_token || null;
          }
          await downloadQuotePdf(data.download_token, finalQuote);

          formContainer.style.display = 'none';
          successEl.classList.add('visible');
          if (data.quote_number) {
            quoteRef.textContent = 'Reference: ' + data.quote_number;
          }
        } catch (err) {
          errorEl.textContent = err.message || 'Something went wrong. Please try again.';
          errorEl.style.display = 'inline';
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Request';
        }
      });
    })();
    