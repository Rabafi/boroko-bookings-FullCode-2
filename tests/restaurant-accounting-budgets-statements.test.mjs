import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const sql=fs.readFileSync(new URL('../supabase/migrations/20260720070000_restaurant_accounting_budgets_statements.sql',import.meta.url),'utf8')
test('validates complete budget matrix before writes',()=>{assert.match(sql,/for v_e in select value from jsonb_array_elements\(p_entries\)/);assert.match(sql,/active lodge account, month 1-12/);assert.ok(sql.indexOf('Every budget entry requires')<sql.indexOf('insert into public.restaurant_budgets'))})
test('makes matrix and template retries payload safe',()=>{assert.match(sql,/restaurant_budget_operations/);assert.match(sql,/Budget idempotency key conflicts with a different matrix/);assert.match(sql,/Template idempotency key conflicts with different content/);assert.match(sql,/Template application key conflicts with different parameters/)})
test('validates template ownership and active lodge accounts',()=>{assert.match(sql,/Budget template belongs to another lodge or is missing/);assert.match(sql,/Template contains inactive or cross-lodge accounts/);assert.match(sql,/on conflict\(lodge_id,account_id,period_year,period_month\)/)})
test('only offers active revenue and expense accounts for new budgets',()=>{assert.match(sql,/a\.is_active and a\.account_type in\('revenue','expense'\)/);assert.match(sql,/period_month,b\.budget_amount/)})
test('derives balance sheet and income statement from posted journals',()=>{assert.match(sql,/get_restaurant_financial_statements_v2/);assert.match(sql,/e\.is_posted and e\.entry_date<=p_end_date/);assert.match(sql,/current_period_earnings/);assert.match(sql,/'difference'/)})
test('preserves historical inactive account activity',()=>{assert.match(sql,/'is_active',is_active/);assert.match(sql,/where balance<>0 or is_active/);assert.match(sql,/where amount<>0 or is_active/)})
test('classifies cash flows explicitly and reports ambiguity',()=>{assert.match(sql,/cash_flow_classification='cash'/);assert.match(sql,/classes\[1\] in\('operating','investing','financing'\)/);assert.match(sql,/else 'unclassified'/)})
test('keeps budgets and statements service-role only',()=>{assert.doesNotMatch(sql,/grant execute[\s\S]*to authenticated/i);assert.match(sql,/revoke all on function public\.get_restaurant_financial_statements_v2/)})
