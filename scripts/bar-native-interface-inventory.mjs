import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

// Static inventory only. Never imports application runtime or contacts a DB.
const root = process.cwd()
const renderer = path.join(root, 'src/renderer/src')
const parse = file => ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX)
function visit(node, fn) { fn(node); ts.forEachChild(node, child => visit(child, fn)) }
function routes(file) {
  const source = parse(file), rows = []
  visit(source, node => {
    if (!ts.isJsxSelfClosingElement(node) || node.tagName.getText(source) !== 'Route') return
    const attrs = node.attributes.properties.filter(ts.isJsxAttribute)
    const route = attrs.find(attr => attr.name.getText(source) === 'path')?.initializer
    if (!route || !ts.isStringLiteral(route)) return
    const element = attrs.find(attr => attr.name.getText(source) === 'element')?.initializer
    const text = element?.getText(source) || ''
    rows.push({ route: '/' + route.text.replace(/^\//, ''), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      components: [...text.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)].map(match => match[1]).filter(name => !['Lazy','RestaurantOnlyRoute','UpgradeWall','BarAddonFeatureRoute','CapabilityRoute','RestaurantAccountingRoute'].includes(name)),
      element: text })
  })
  return rows
}
function imports(file) {
  const source = parse(file), found = new Map()
  visit(source, node => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const match = node.initializer.getText(source).match(/\bimport\(['"]([^'"]+)['"]\)/)
      if (match) found.set(node.name.getText(source), match[1])
    }
  })
  return found
}
function resolveRelative(file, specifier) {
  if (!specifier.startsWith('.')) return null
  const base = path.resolve(path.dirname(file), specifier)
  return [base, ...['.jsx','.js','.tsx','.ts'].map(ext => base + ext), path.join(base,'index.js')].find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile() && /\.[jt]sx?$/.test(candidate)) || null
}
function apiInventory(file, seen = new Set()) {
  if (seen.has(file)) return []
  seen.add(file)
  const source = parse(file), refs = [], dependencies = []
  visit(source, node => {
    if (ts.isCallExpression(node)) {
      const expr = node.expression.getText(source).replaceAll('?.', '.')
      if (/^(?:window\.api|api|localApi)\./.test(expr) || /(?:accountingInvoke|invokeAccounting)$/.test(expr)) {
        refs.push({ file: path.relative(root,file).replaceAll('\\','/'), line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          call: expr, operation: /accountingInvoke|invokeAccounting/.test(expr) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : null })
      }
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const dependency = resolveRelative(file,node.moduleSpecifier.text)
      if (dependency && dependency.includes(path.join('src','renderer','src','components'))) dependencies.push(dependency)
    }
  })
  return refs.concat(...dependencies.map(dependency => apiInventory(dependency, seen)))
}
const originalFile = path.join(renderer,'App.jsx')
const localFile = path.join(renderer,'components/hospitality-pos/LocalBarHposShell.jsx')
const original = routes(originalFile).filter(row => /^\/(hpos|restaurant)\//.test(row.route) || ['/staff','/settings','/data-management','/pos/customer-display','/pos/bar-display'].includes(row.route))
const local = new Map(routes(localFile).map(row => [row.route,row]))
const lazyImports = imports(originalFile)
const inventory = original.map(row => {
  const current = local.get(row.route)
  const refs = row.components.flatMap(name => {
    const specifier = lazyImports.get(name)
    const file = specifier ? resolveRelative(originalFile,specifier) : null
    return file ? apiInventory(file) : []
  })
  return { ...row, local_components: current?.components || [], local_line: current?.line || null,
    state: !current ? 'MISSING_LOCAL_ROUTE' : current.components.includes('BarLocalWorkspace') ? 'REPLACEMENT_PANEL' : JSON.stringify(row.components) === JSON.stringify(current.components) ? 'ORIGINAL_COMPONENT_REQUIRES_BEHAVIOUR_ACCEPTANCE' : 'CHECK_MAPPING',
    api_calls: refs }
})
const out = path.join(root,'docs/engineering/bar-local-first/evidence/native-interface-restoration-2026-11-05')
fs.mkdirSync(out,{recursive:true})
fs.writeFileSync(path.join(out,'route-api-inventory.json'),JSON.stringify({ generated_at:new Date().toISOString(), note:'Static source inventory, not behaviour acceptance. Relative component dependencies included; dynamic alias calls require manual tracing.', routes:inventory },null,2)+'\n')
const csv = value => '"' + String(value ?? '').replaceAll('"','""') + '"'
fs.writeFileSync(path.join(out,'route-coverage.csv'),['route,original_components,local_components,state,api_reference_count', ...inventory.map(row => [row.route,row.components.join('|'),row.local_components.join('|'),row.state,row.api_calls.length].map(csv).join(','))].join('\n')+'\n')
const counts = {}
for (const row of inventory) counts[row.state] = (counts[row.state] || 0) + 1
const calls = [...new Set(inventory.flatMap(row => row.api_calls.map(ref => ref.operation ? `${ref.call}:${ref.operation}` : ref.call)))].sort()
fs.writeFileSync(path.join(out,'api-methods.json'),JSON.stringify(calls,null,2)+'\n')
console.log(JSON.stringify({routes:inventory.length,states:counts,distinct_static_api_methods:calls.length,evidence:path.relative(root,out)},null,2))
