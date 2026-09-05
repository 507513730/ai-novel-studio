function classifyServerError(line) {
  if (!line.includes('[api]')) return null
  if (/JSON|schema validation|Unexpected token/i.test(line)) return 'structured-output'
  if (/timed? ?out|timeout|超时/i.test(line)) return 'upstream-timeout'
  if (/connection|fetch failed|ECONN|ENOTFOUND/i.test(line)) return 'upstream-connection'
  if (/429|rate.?limit/i.test(line)) return 'upstream-rate-limit'
  if (/401|403|API Key|decrypt|解密/i.test(line)) return 'credential-or-permission'
  if (/constraint|UNIQUE|SQLITE_BUSY/i.test(line)) return 'database'
  return 'unclassified'
}
module.exports = { classifyServerError }
