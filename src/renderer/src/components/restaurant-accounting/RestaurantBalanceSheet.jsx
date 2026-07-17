import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calculator,
  Calendar,
  CheckCircle2,
  FileText,
  Loader2,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';

const TABS = [
  { key: 'balance_sheet', label: 'Balance Sheet', icon: Wallet },
  { key: 'income_statement', label: 'Income Statement', icon: FileText },
  { key: 'cash_flow', label: 'Cash Flow', icon: BarChart3 },
  { key: 'all', label: 'All Statements', icon: Calculator },
];

const money = (v) =>
  Number(v || 0).toLocaleString('en-BW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

function BalanceSheetSection({ title, items, total, indent = false }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="hpos-card" style={{ marginBottom: '0.5rem' }}>
      <h4 style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>{title}</h4>
      <table className="hpos-table">
        <thead>
          <tr>
            <th style={{ width: '80px' }}>Code</th>
            <th>Account</th>
            <th style={{ textAlign: 'right', width: '140px' }}>Balance</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.code}>
              <td className="hpos-mono">{item.code}</td>
              <td style={indent ? { paddingLeft: '1.5rem' } : {}}>{item.name}</td>
              <td className="hpos-mono" style={{ textAlign: 'right' }}>
                {money(item.balance || item.amount)}
              </td>
            </tr>
          ))}
          <tr style={{ fontWeight: 700, borderTop: '2px solid var(--hpos-border, #e5e7eb)' }}>
            <td colSpan={2}>{title} Total</td>
            <td className="hpos-mono" style={{ textAlign: 'right' }}>{money(total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BalanceSheetView({ data }) {
  const bs = data?.data;
  if (!bs) return <div className="hpos-empty-state"><p>No data available</p></div>;

  const isBalanced = bs.is_balanced;
  const diff = Number(bs.difference || 0);

  return (
    <div>
      <div className="hpos-page-header" style={{ marginBottom: '1rem' }}>
        <h3>Balance Sheet as of {bs.as_of_date || today()}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isBalanced ? (
            <span className="hpos-badge hpos-badge-success">
              <CheckCircle2 size={14} /> Balanced
            </span>
          ) : (
            <span className="hpos-badge hpos-badge-danger">
              <AlertTriangle size={14} /> Off by {money(diff)}
            </span>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        {/* Assets */}
        <div>
          <h3 style={{ marginBottom: '0.75rem', borderBottom: '2px solid var(--hpos-primary, #2563eb)', paddingBottom: '0.25rem' }}>
            Assets
          </h3>
          <BalanceSheetSection
            title="Current Assets"
            items={bs.current_assets?.items}
            total={bs.current_assets?.total}
          />
          <BalanceSheetSection
            title="Fixed Assets"
            items={bs.fixed_assets?.items}
            total={bs.fixed_assets?.gross_total}
          />
          {Number(bs.accumulated_depreciation?.total || 0) !== 0 && (
            <div className="hpos-card" style={{ marginBottom: '0.5rem', padding: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Less: Accumulated Depreciation</span>
                <span className="hpos-mono">({money(bs.accumulated_depreciation?.total)})</span>
              </div>
            </div>
          )}
          <div className="hpos-card" style={{ fontWeight: 700, padding: '0.75rem', background: 'var(--hpos-bg-alt, #f8fafc)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Total Assets</span>
              <span className="hpos-mono">{money(bs.total_assets)}</span>
            </div>
          </div>
        </div>

        {/* Liabilities & Equity */}
        <div>
          <h3 style={{ marginBottom: '0.75rem', borderBottom: '2px solid var(--hpos-primary, #2563eb)', paddingBottom: '0.25rem' }}>
            Liabilities & Equity
          </h3>
          <BalanceSheetSection
            title="Current Liabilities"
            items={bs.current_liabilities?.items}
            total={bs.current_liabilities?.total}
          />
          <div className="hpos-card" style={{ fontWeight: 600, marginBottom: '0.5rem', padding: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Total Liabilities</span>
              <span className="hpos-mono">{money(bs.total_liabilities)}</span>
            </div>
          </div>

          <BalanceSheetSection
            title="Owner's Equity"
            items={bs.owners_equity?.items}
            total={bs.owners_equity?.total}
          />
          {Number(bs.retained_earnings?.balance || 0) !== 0 && (
            <div className="hpos-card" style={{ marginBottom: '0.5rem', padding: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Retained Earnings (Net Income)</span>
                <span className="hpos-mono">{money(bs.retained_earnings?.balance)}</span>
              </div>
            </div>
          )}
          <div className="hpos-card" style={{ fontWeight: 700, marginBottom: '0.5rem', padding: '0.75rem', background: 'var(--hpos-bg-alt, #f8fafc)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Total Equity</span>
              <span className="hpos-mono">{money(bs.total_equity)}</span>
            </div>
          </div>
          <div className="hpos-card" style={{ fontWeight: 700, padding: '0.75rem', borderTop: '3px solid var(--hpos-primary, #2563eb)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Total Liabilities & Equity</span>
              <span className="hpos-mono">{money(bs.total_liabilities_and_equity)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IncomeStatementView({ data }) {
  const is = data?.data;
  if (!is) return <div className="hpos-empty-state"><p>No data available</p></div>;

  const netIncome = Number(is.net_income || 0);

  return (
    <div>
      <div className="hpos-page-header" style={{ marginBottom: '1rem' }}>
        <h3>Income Statement: {data.start_date} to {data.end_date}</h3>
        <span className={`hpos-badge ${netIncome >= 0 ? 'hpos-badge-success' : 'hpos-badge-danger'}`}>
          {netIncome >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          Net {netIncome >= 0 ? 'Income' : 'Loss'}: {money(netIncome)}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div className="hpos-card">
          <h4 style={{ margin: '0 0 0.5rem', color: 'var(--hpos-success, #16a34a)' }}>Revenue</h4>
          <table className="hpos-table">
            <thead>
              <tr><th>Account</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
            </thead>
            <tbody>
              {(is.revenue?.items || []).map((r) => (
                <tr key={r.code}>
                  <td>{r.code} - {r.name}</td>
                  <td className="hpos-mono" style={{ textAlign: 'right' }}>{money(r.amount)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Total Revenue</td>
                <td className="hpos-mono" style={{ textAlign: 'right' }}>{money(is.revenue?.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="hpos-card">
          <h4 style={{ margin: '0 0 0.5rem', color: 'var(--hpos-danger, #dc2626)' }}>Expenses</h4>
          <table className="hpos-table">
            <thead>
              <tr><th>Account</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
            </thead>
            <tbody>
              {(is.expenses?.items || []).map((e) => (
                <tr key={e.code}>
                  <td>{e.code} - {e.name}</td>
                  <td className="hpos-mono" style={{ textAlign: 'right' }}>{money(e.amount)}</td>
                </tr>
              ))}
              <tr style={{ fontWeight: 700 }}>
                <td>Total Expenses</td>
                <td className="hpos-mono" style={{ textAlign: 'right' }}>{money(is.expenses?.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="hpos-card" style={{ marginTop: '1rem', fontWeight: 700, fontSize: '1.1rem', padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Net Income</span>
          <span className="hpos-mono" style={{ color: netIncome >= 0 ? 'var(--hpos-success, #16a34a)' : 'var(--hpos-danger, #dc2626)' }}>
            {money(netIncome)}
          </span>
        </div>
      </div>
    </div>
  );
}

function CashFlowView({ data }) {
  const cf = data?.data;
  if (!cf) return <div className="hpos-empty-state"><p>No data available</p></div>;

  const netCash = Number(cf.net_cash_flow || 0);

  const renderSection = (title, section, color) => (
    <div className="hpos-card" style={{ marginBottom: '0.75rem' }}>
      <h4 style={{ margin: '0 0 0.5rem', color }}>{title}</h4>
      {(section?.items || section?.inflows || []).length === 0 ? (
        <p style={{ color: 'var(--hpos-text-muted, #6b7280)', fontStyle: 'italic' }}>No activity</p>
      ) : (
        <table className="hpos-table">
          <thead>
            <tr><th>Source</th><th style={{ textAlign: 'right' }}>Amount</th></tr>
          </thead>
          <tbody>
            {(section?.items || section?.inflows || []).map((item, i) => (
              <tr key={i}>
                <td>{item.source}</td>
                <td className="hpos-mono" style={{ textAlign: 'right' }}>{money(item.amount)}</td>
              </tr>
            ))}
            {section?.outflows?.map((item, i) => (
              <tr key={`out-${i}`}>
                <td>{item.source} (outflow)</td>
                <td className="hpos-mono" style={{ textAlign: 'right', color: 'var(--hpos-danger, #dc2626)' }}>({money(item.amount)})</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 700 }}>
              <td>Net {title}</td>
              <td className="hpos-mono" style={{ textAlign: 'right', color: Number(section?.net || 0) >= 0 ? 'var(--hpos-success, #16a34a)' : 'var(--hpos-danger, #dc2626)' }}>
                {money(section?.net)}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div>
      <div className="hpos-page-header" style={{ marginBottom: '1rem' }}>
        <h3>Cash Flow Statement: {data.start_date} to {data.end_date}</h3>
        <span className={`hpos-badge ${netCash >= 0 ? 'hpos-badge-success' : 'hpos-badge-danger'}`}>
          Net Cash Flow: {money(netCash)}
        </span>
      </div>

      {renderSection('Operating Activities', cf.operating_activities, 'var(--hpos-primary, #2563eb)')}
      {renderSection('Investing Activities', cf.investing_activities, 'var(--hpos-warning, #d97706)')}
      {renderSection('Financing Activities', cf.financing_activities, 'var(--hpos-success, #16a34a)')}

      <div className="hpos-card" style={{ fontWeight: 700, fontSize: '1.1rem', padding: '1rem', borderTop: '3px solid var(--hpos-primary, #2563eb)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Net Change in Cash</span>
          <span className="hpos-mono" style={{ color: netCash >= 0 ? 'var(--hpos-success, #16a34a)' : 'var(--hpos-danger, #dc2626)' }}>
            {money(netCash)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function RestaurantBalanceSheet() {
  const [tab, setTab] = useState('balance_sheet');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [balanceSheetData, setBalanceSheetData] = useState(null);
  const [incomeStatementData, setIncomeStatementData] = useState(null);
  const [cashFlowData, setCashFlowData] = useState(null);
  const [allData, setAllData] = useState(null);

  const [bsDate, setBsDate] = useState(today);
  const [startDate, setStartDate] = useState(monthStart);
  const [endDate, setEndDate] = useState(today);

  const loadBalanceSheet = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await window.api.restaurantBalanceSheet.getBalanceSheet(bsDate || null);
      setBalanceSheetData(result);
    } catch (err) {
      setError(err.message || 'Failed to load balance sheet');
    } finally {
      setLoading(false);
    }
  }, [bsDate]);

  const loadIncomeStatement = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await window.api.restaurantBalanceSheet.getIncomeStatement(startDate, endDate);
      setIncomeStatementData(result);
    } catch (err) {
      setError(err.message || 'Failed to load income statement');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  const loadCashFlow = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await window.api.restaurantBalanceSheet.getCashFlowStatement(startDate, endDate);
      setCashFlowData(result);
    } catch (err) {
      setError(err.message || 'Failed to load cash flow statement');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await window.api.restaurantBalanceSheet.getFinancialStatements(startDate, endDate);
      setAllData(result);
    } catch (err) {
      setError(err.message || 'Failed to load financial statements');
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  const handleGenerate = useCallback(() => {
    if (tab === 'balance_sheet') loadBalanceSheet();
    else if (tab === 'income_statement') loadIncomeStatement();
    else if (tab === 'cash_flow') loadCashFlow();
    else if (tab === 'all') loadAll();
  }, [tab, loadBalanceSheet, loadIncomeStatement, loadCashFlow, loadAll]);

  useEffect(() => {
    handleGenerate();
  }, []);

  return (
    <div className="hpos-page">
      <div className="hpos-page-header">
        <Calculator size={24} />
        <h2>Financial Statements</h2>
      </div>

      {/* Tabs */}
      <div className="hpos-tabs" style={{ marginBottom: '1rem' }}>
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              className={`hpos-tab ${tab === t.key ? 'hpos-tab-active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <Icon size={16} /> {t.label}
            </button>
          );
        })}
      </div>

      {error && <div className="hpos-error"><AlertTriangle size={16} /> {error}</div>}

      {/* Date controls */}
      <div className="hpos-card" style={{ marginBottom: '1rem', padding: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {tab === 'balance_sheet' ? (
            <label>
              <Calendar size={14} /> As of Date
              <input
                type="date"
                value={bsDate}
                onChange={(e) => setBsDate(e.target.value)}
              />
            </label>
          ) : (
            <>
              <label>
                <Calendar size={14} /> Start Date
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </label>
              <label>
                <Calendar size={14} /> End Date
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </label>
            </>
          )}
          <button
            className="hpos-btn hpos-btn-primary"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : 'Generate'}
          </button>
        </div>
      </div>

      {loading && (
        <div className="hpos-empty-state">
          <Loader2 size={32} className="animate-spin" />
          <p>Loading financial data...</p>
        </div>
      )}

      {!loading && tab === 'balance_sheet' && balanceSheetData && (
        <BalanceSheetView data={balanceSheetData} />
      )}

      {!loading && tab === 'income_statement' && incomeStatementData && (
        <IncomeStatementView data={incomeStatementData} />
      )}

      {!loading && tab === 'cash_flow' && cashFlowData && (
        <CashFlowView data={cashFlowData} />
      )}

      {!loading && tab === 'all' && allData && (
        <div>
          <h3 style={{ marginBottom: '1rem' }}>Consolidated Financial Statements: {startDate} to {endDate}</h3>
          {allData.balance_sheet?.success && <BalanceSheetView data={allData.balance_sheet} />}
          <div style={{ marginTop: '1.5rem' }} />
          {allData.income_statement?.success && <IncomeStatementView data={allData.income_statement} />}
          <div style={{ marginTop: '1.5rem' }} />
          {allData.cash_flow_statement?.success && <CashFlowView data={allData.cash_flow_statement} />}
        </div>
      )}
    </div>
  );
}
