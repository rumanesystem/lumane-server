import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import YAML from 'yaml';

export const frontendExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.html']);
export const approvedNetworkClientFiles = new Set(['src/api/client.ts']);

const sourceRules = [
  ['dangerouslySetInnerHTML', /\bdangerouslySetInnerHTML\b/],
  ['innerHTML', /\binnerHTML\b/],
  ['outerHTML', /\bouterHTML\b/],
  ['insertAdjacentHTML', /\binsertAdjacentHTML\b/],
  ['computed HTML sink', /["'`](?:innerHTML|outerHTML|insertAdjacentHTML)["'`]|["'`](?:inner|outer|insertAdjacent)["'`]\s*\+\s*["'`]HTML["'`]/],
  ['browser global write', /\b(?:window|globalThis|self)\s*(?:\.(?!location\b)\w+|\[(?!["'`]location["'`])[^\]]+\])\s*=(?!=)|\b(?:Object\.assign|Object\.defineProperty|Reflect\.set)\s*\(\s*(?:window|globalThis|self)\b/],
];

const networkModules = new Set(['axios', 'ky', 'ofetch', 'got', 'superagent', 'wretch']);
const networkConstructors = new Set(['XMLHttpRequest', 'WebSocket', 'EventSource']);
const htmlSinks = new Set(['innerHTML', 'outerHTML', 'insertAdjacentHTML']);

function staticPropertyName(node) {
  if (node?.type !== 'MemberExpression' && node?.type !== 'OptionalMemberExpression') return undefined;
  if (!node.computed && node.property?.type === 'Identifier') return node.property.name;
  return staticString(node.property);
}

function staticString(node) {
  if (!node) return undefined;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral') {
    let value = node.quasis[0]?.value.cooked ?? '';
    for (let index = 0; index < node.expressions.length; index += 1) {
      const expression = staticString(node.expressions[index]);
      if (expression === undefined) return undefined;
      value += expression + (node.quasis[index + 1]?.value.cooked ?? '');
    }
    return value;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left);
    const right = staticString(node.right);
    return left === undefined || right === undefined ? undefined : left + right;
  }
  return undefined;
}

function analyzeScriptAst(file, source, allowNetworkClient) {
  const root = parse(source, { sourceType: 'module', plugins: ['typescript', ...(file.endsWith('x') ? ['jsx'] : [])] });
  const globalAliases = new Set(['window', 'globalThis', 'self']);
  const styleObjectAliases = new Set();
  const domParserAliases = new Set();
  const failures = [];

  const globalPath = (node) => {
    if (node?.type === 'Identifier' && globalAliases.has(node.name)) return [];
    if (node?.type === 'MemberExpression' || node?.type === 'OptionalMemberExpression') {
      const base = globalPath(node.object);
      const property = staticPropertyName(node);
      return base && property ? [...base, property] : undefined;
    }
    return undefined;
  };

  const walk = (node, visitor, ancestors = []) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') visitor(node, ancestors);
    for (const [key, value] of Object.entries(node)) {
      if (['loc', 'start', 'end', 'extra', 'errors'].includes(key)) continue;
      if (Array.isArray(value)) value.forEach((child) => walk(child, visitor, [...ancestors, node]));
      else if (value && typeof value === 'object') walk(value, visitor, [...ancestors, node]);
    }
  };
  const objectHasStyle = (node) => node?.type === 'ObjectExpression' && node.properties.some((property) => property.type === 'ObjectProperty' && (property.key.name ?? property.key.value) === 'style');

  walk(root, (node) => {
    if (node.type === 'ImportDeclaration' && networkModules.has(node.source.value)) {
      if (!allowNetworkClient) failures.push(`${file}: forbidden network import ${node.source.value} outside approved API client boundary`);
    }
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.init) {
      if (globalPath(node.init)) globalAliases.add(node.id.name);
      if (node.init.type === 'NewExpression' && node.init.callee.type === 'Identifier' && node.init.callee.name === 'DOMParser') domParserAliases.add(node.id.name);
      const transitiveStyle = node.init.type === 'Identifier' && styleObjectAliases.has(node.init.name) || node.init.type === 'ObjectExpression' && node.init.properties.some((property) => property.type === 'SpreadElement' && property.argument.type === 'Identifier' && styleObjectAliases.has(property.argument.name));
      if (objectHasStyle(node.init) || transitiveStyle) styleObjectAliases.add(node.id.name);
    }
    if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier') {
      if (globalPath(node.right)) globalAliases.add(node.left.name);
    }
  });

  walk(root, (node) => {
    if ((node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') && htmlSinks.has(staticPropertyName(node) ?? '')) failures.push(`${file}: forbidden AST HTML sink ${staticPropertyName(node)}`);
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
      if (staticPropertyName(node.callee) === 'parseFromString') {
        const receiver = node.callee.object;
        const isDomParser = receiver?.type === 'NewExpression' && receiver.callee.type === 'Identifier' && receiver.callee.name === 'DOMParser' || receiver?.type === 'Identifier' && domParserAliases.has(receiver.name);
        if (isDomParser) failures.push(`${file}: forbidden DOMParser.parseFromString`);
      }
    }
    if (node.type === 'AssignmentExpression') {
      const path = globalPath(node.left);
      if (path && path[0] !== 'location') failures.push(`${file}: forbidden AST browser global write`);
    }
    if (node.type === 'JSXAttribute' && node.name.type === 'JSXIdentifier' && node.name.name.toLowerCase() === 'style') failures.push(`${file}: forbidden AST JSX inline style`);
    if (node.type === 'JSXSpreadAttribute') {
      const unsafeObject = objectHasStyle(node.argument);
      const unsafeAlias = node.argument.type === 'Identifier' && styleObjectAliases.has(node.argument.name);
      if (unsafeObject || unsafeAlias) failures.push(`${file}: forbidden JSX spread containing style`);
    }
  });

  if (!allowNetworkClient) {
    const resolvingBindings = new Set();
    const bindingSource = (binding) => {
      if (!binding || resolvingBindings.has(binding)) return undefined;
      resolvingBindings.add(binding);
      let result;
      if (binding.path.isImportSpecifier() || binding.path.isImportDefaultSpecifier() || binding.path.isImportNamespaceSpecifier()) {
        const declaration = binding.path.parentPath;
        result = declaration.isImportDeclaration() && networkModules.has(declaration.node.source.value) ? 'network' : undefined;
      } else if (binding.path.isVariableDeclarator()) {
        const init = binding.path.get('init');
        const id = binding.path.get('id');
        if (id.isObjectPattern() && init?.node && isBrowserGlobalPath(init)) {
          const property = id.get('properties').find((candidate) => candidate.isObjectProperty()
            && (candidate.node.key.name ?? candidate.node.key.value) === 'fetch'
            && candidate.get('value').isIdentifier({ name: binding.identifier.name }));
          if (property) result = 'network';
        }
        if (!result && init?.node) result = isNetworkPath(init) ? 'network' : undefined;
      }
      if (!result) {
        for (const violation of binding.constantViolations) {
          if (violation.isAssignmentExpression() && isNetworkPath(violation.get('right'))) { result = 'network'; break; }
        }
      }
      resolvingBindings.delete(binding);
      return result;
    };
    const isUnboundGlobal = (path, names) => path.isIdentifier() && names.has(path.node.name) && !path.scope.getBinding(path.node.name);
    const isBrowserGlobalPath = (path) => {
      if (isUnboundGlobal(path, new Set(['window', 'globalThis', 'self']))) return true;
      if (!path.isIdentifier()) return false;
      const binding = path.scope.getBinding(path.node.name);
      if (!binding || resolvingBindings.has(binding) || !binding.path.isVariableDeclarator()) return false;
      resolvingBindings.add(binding);
      const init = binding.path.get('init');
      const result = Boolean(init?.node && isBrowserGlobalPath(init));
      resolvingBindings.delete(binding);
      return result;
    };
    function isNetworkPath(path) {
      if (!path?.node) return false;
      if (path.isIdentifier()) {
        const binding = path.scope.getBinding(path.node.name);
        if (binding) return bindingSource(binding) === 'network';
        return new Set(['fetch', 'axios', 'ky', ...networkConstructors]).has(path.node.name);
      }
      if (path.isCallExpression() && staticPropertyName(path.node.callee) === 'get') {
        const callee = path.get('callee');
        const args = path.get('arguments');
        return callee.get('object').isIdentifier({ name: 'Reflect' }) && !callee.scope.getBinding('Reflect')
          && isBrowserGlobalPath(args[0]) && staticString(args[1]?.node) === 'fetch';
      }
      if (path.isMemberExpression() || path.isOptionalMemberExpression()) {
        const property = staticPropertyName(path.node);
        const object = path.get('object');
        if (property === 'fetch') return isBrowserGlobalPath(object) || isNetworkPath(object);
        if (property === 'sendBeacon') return isUnboundGlobal(object, new Set(['navigator']));
        return isNetworkPath(object);
      }
      return false;
    }
    traverse(root, {
      CallExpression(path) {
        if (isNetworkPath(path.get('callee'))) failures.push(`${file}: forbidden AST network client outside approved API client boundary`);
      },
      OptionalCallExpression(path) {
        if (isNetworkPath(path.get('callee'))) failures.push(`${file}: forbidden AST network client outside approved API client boundary`);
      },
      NewExpression(path) {
        if (isNetworkPath(path.get('callee'))) failures.push(`${file}: forbidden AST network constructor outside approved API client boundary`);
      },
    });
  }
  return failures;
}

function hasRawInlineHandler(source, extension) {
  const inlineHandler = /\son[a-z]+\s*=/i;
  if (extension === '.html') return inlineHandler.test(source);
  const stringLiteral = /(["'`])(?:\\[\s\S]|(?!\1)[\s\S])*\1/g;
  for (const match of source.matchAll(stringLiteral)) {
    if (/<[^>]+>/s.test(match[0]) && inlineHandler.test(match[0])) return true;
  }
  return false;
}

function atRuleBodies(source, rule) {
  const bodies = [];
  let cursor = 0;
  while ((cursor = source.indexOf(rule, cursor)) !== -1) {
    const open = source.indexOf('{', cursor + rule.length);
    if (open === -1) break;
    let depth = 1;
    let end = open + 1;
    while (end < source.length && depth > 0) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}') depth -= 1;
      end += 1;
    }
    if (depth === 0) bodies.push(source.slice(open + 1, end - 1));
    cursor = end;
  }
  return bodies;
}

export function analyzeSource(file, source, allowedBreakpoints = new Set(), options = {}) {
  const extension = path.extname(file).toLowerCase();
  if (!frontendExtensions.has(extension)) return [];
  const failures = [];
  for (const [label, pattern] of sourceRules) {
    if (pattern.test(source)) failures.push(`${file}: forbidden ${label}`);
  }
  const normalizedFile = file.replaceAll('\\', '/');
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs'].includes(extension)) failures.push(...analyzeScriptAst(file, source, Boolean(options.allowNetworkClient)));
  const hasInlineStyle = extension === '.html' ? /\sstyle\s*=/i.test(source) : ['.tsx', '.jsx'].includes(extension) && /\bstyle\s*=\s*\{/i.test(source);
  if (hasInlineStyle) failures.push(`${file}: forbidden inline style`);
  if (hasRawInlineHandler(source, extension)) failures.push(`${file}: forbidden raw HTML inline event handler`);
  if (extension === '.css') {
    for (const media of source.matchAll(/@media\s*([^\{]+)/g)) {
      for (const widthCondition of media[1].matchAll(/(?:min|max)-width\s*:\s*([^\)]+)/g)) {
        if (!allowedBreakpoints.has(widthCondition[1].trim())) failures.push(`${file}: responsive width ${widthCondition[1].trim()} is not an exact DESIGN.md x-breakpoint`);
      }
      for (const literal of media[1].matchAll(/\b\d+px\b/g)) {
        if (!allowedBreakpoints.has(literal[0])) failures.push(`${file}: responsive literal ${literal[0]} is not in DESIGN.md x-breakpoints`);
      }
    }
    if (!normalizedFile.endsWith('/tokens.css')) {
      const declarations = source.replace(/@media\s*[^\{]+\{/g, '@media {').replace(/@font-face\s*\{[^}]*\}/gs, '');
      const parsedDeclarations = [...declarations.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/gi)].map((match) => ({ property: match[1].toLowerCase(), value: match[2].trim() }));
      const manualDimension = /(?:margin|padding|gap|width|height|inset|top|right|bottom|left|border-radius|font-size|letter-spacing|transform)(?:-[a-z]+)?\s*:[^;{}]*\b\d+(?:\.\d+)?(?:px|rem|em|vw|vh|dvw|dvh|vmin|vmax|ch|ex)\b/i;
      const manualTypography = /(?:font-weight|line-height)\s*:\s*\d+(?:\.\d+)?\s*(?:;|})/i;
      if (manualDimension.test(declarations) || manualTypography.test(declarations)) failures.push(`${file}: manual spacing, layout, or typography literal must use a DESIGN.md token`);
      if (parsedDeclarations.some(({ property }) => property.startsWith('--'))) failures.push(`${file}: local CSS custom properties must be defined in generated DESIGN.md tokens`);
      if (/(?:#(?:[0-9a-f]{3,8})\b|\b(?:rgb|hsl)a?\s*\()/i.test(declarations)) failures.push(`${file}: hardcoded CSS color must use a DESIGN.md token`);
      const colorHardcoded = parsedDeclarations.some(({ property, value }) => /^(?:color|background|background-color|border-color|outline-color)$/.test(property) && !value.includes('var(') && !/^(?:inherit|currentcolor|none)$/.test(value.toLowerCase()));
      const borderHardcoded = parsedDeclarations.some(({ property, value }) => /^border(?:-(?:top|right|bottom|left))?(?:-(?:width|style|color))?$|^border-(?:radius|top-left-radius|top-right-radius|bottom-left-radius|bottom-right-radius)$/.test(property) && !/^(?:0|none)$/.test(value) && !value.includes('var('));
      const shadowHardcoded = parsedDeclarations.some(({ property, value }) => property === 'box-shadow' && value !== 'none' && !value.includes('var('));
      const gridHardcoded = parsedDeclarations.some(({ property, value }) => /grid-template-(?:columns|rows)/.test(property) && !value.startsWith('var('));
      const outlineHardcoded = parsedDeclarations.some(({ property, value }) => property.startsWith('outline') && !/^(?:0|none)$/.test(value) && !value.includes('var('));
      if (colorHardcoded) failures.push(`${file}: hardcoded CSS color property must use a DESIGN.md token`);
      if (borderHardcoded) failures.push(`${file}: hardcoded CSS border must use a DESIGN.md token`);
      if (shadowHardcoded) failures.push(`${file}: hardcoded CSS shadow must use a DESIGN.md token`);
      if (gridHardcoded) failures.push(`${file}: hardcoded CSS grid must use a DESIGN.md token`);
      if (outlineHardcoded) failures.push(`${file}: hardcoded CSS outline must use a DESIGN.md token`);
      if (atRuleBodies(source, '@media').some((body) => /(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i.test(body))) failures.push(`${file}: responsive hiding can remove critical mobile actions`);
    }
  }
  return failures;
}

function walk(directory, base, allowedBreakpoints, failures) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'test-results', 'playwright-report', 'tests'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, base, allowedBreakpoints, failures);
    else if (frontendExtensions.has(path.extname(file).toLowerCase())) {
      const relative = path.relative(base, file).replaceAll('\\', '/');
      failures.push(...analyzeSource(relative, fs.readFileSync(file, 'utf8'), allowedBreakpoints, { allowNetworkClient: approvedNetworkClientFiles.has(relative) }));
    }
  }
}

export function scanFrontend(root, allowedBreakpoints) {
  const failures = [];
  for (const target of [path.join(root, 'index.html'), path.join(root, 'src')]) {
    if (!fs.existsSync(target)) continue;
    if (fs.statSync(target).isDirectory()) walk(target, root, allowedBreakpoints, failures);
    else {
      const relative = path.relative(root, target).replaceAll('\\', '/');
      failures.push(...analyzeSource(relative, fs.readFileSync(target, 'utf8'), allowedBreakpoints, { allowNetworkClient: approvedNetworkClientFiles.has(relative) }));
    }
  }
  return failures;
}

function run() {
  const root = path.resolve(import.meta.dirname, '..', 'frontend', 'admin');
  const design = fs.readFileSync(path.resolve(root, '..', '..', 'DESIGN.md'), 'utf8');
  const frontMatter = design.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontMatter) throw new Error('DESIGN.md front matter was not found.');
  const designTokens = YAML.parse(frontMatter[1]);
  const allowedBreakpoints = new Set(Object.values(designTokens['x-breakpoints'] ?? {}).map(String));
  const failures = scanFrontend(root, allowedBreakpoints);
  if (failures.length) {
    console.error(failures.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Frontend guardrails passed.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) run();
