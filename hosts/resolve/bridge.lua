-- HermiteCut — standalone bridge to DaVinci Resolve.
--
-- Run by the HermiteCut app as:  fuscript -l lua bridge.lua
-- (needs Preferences > System > General > External scripting using: Local)
--
-- Protocol: one JSON object per line on stdin, one reply per line on stdout.
--   request  {"id":1,"h":0,"m":"GetProjectManager","a":[...]}   h = handle (0 = Resolve)
--            {"id":2,"op":"release","h":5}                       forget a handle
--            {"id":3,"op":"ping"}
--   reply    {"id":1,"ok":true,"r":<value>}  or  {"id":1,"ok":false,"e":"message"}
-- Objects (userdata) travel as {"$h":<handle>}. Lua has no JSON library inside
-- fuscript, so a small encoder and decoder are included.

local M = {}

-- ---------------------------------------------------------------- JSON
local function esc(s)
  return (s:gsub('[%c"\\]', function(c)
    local map = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
    return map[c] or string.format('\\u%04x', c:byte())
  end))
end

local function is_array(t)
  local n = 0
  for k in pairs(t) do
    if type(k) ~= 'number' or k < 1 or k % 1 ~= 0 then return false end
    n = n + 1
  end
  for i = 1, n do if t[i] == nil then return false end end
  return true, n
end

function M.encode(v, handle_of)
  local ty = type(v)
  if v == nil then return 'null'
  elseif ty == 'boolean' then return v and 'true' or 'false'
  elseif ty == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then return 'null' end
    if v % 1 == 0 and v > -1e15 and v < 1e15 then return string.format('%d', v) end
    return string.format('%.17g', v)
  elseif ty == 'string' then return '"' .. esc(v) .. '"'
  elseif ty == 'table' then
    local arr, n = is_array(v)
    local out = {}
    if arr and n > 0 then
      for i = 1, n do out[i] = M.encode(v[i], handle_of) end
      return '[' .. table.concat(out, ',') .. ']'
    end
    for k, x in pairs(v) do
      out[#out + 1] = '"' .. esc(tostring(k)) .. '":' .. M.encode(x, handle_of)
    end
    return '{' .. table.concat(out, ',') .. '}'
  else -- userdata, function
    if handle_of then return '{"$h":' .. handle_of(v) .. '}' end
    return 'null'
  end
end

function M.decode(s)
  local pos = 1
  local function ws() pos = s:find('[^ \t\r\n]', pos) or #s + 1 end
  local value
  local function str()
    local out, i = {}, pos + 1
    while true do
      local c = s:sub(i, i)
      if c == '"' then pos = i + 1; return table.concat(out) end
      if c == '' then error('unterminated string') end
      if c == '\\' then
        local n = s:sub(i + 1, i + 1)
        local map = { b = '\b', f = '\f', n = '\n', r = '\r', t = '\t', ['"'] = '"', ['\\'] = '\\', ['/'] = '/' }
        if n == 'u' then
          local cp = tonumber(s:sub(i + 2, i + 5), 16)
          if cp < 128 then out[#out + 1] = string.char(cp)
          elseif cp < 2048 then out[#out + 1] = string.char(192 + math.floor(cp / 64), 128 + cp % 64)
          else out[#out + 1] = string.char(224 + math.floor(cp / 4096), 128 + math.floor(cp / 64) % 64, 128 + cp % 64) end
          i = i + 6
        else out[#out + 1] = map[n] or n; i = i + 2 end
      else out[#out + 1] = c; i = i + 1 end
    end
  end
  function value()
    ws()
    local c = s:sub(pos, pos)
    if c == '{' then
      local t = {}; pos = pos + 1; ws()
      if s:sub(pos, pos) == '}' then pos = pos + 1; return t end
      while true do
        ws(); local k = str(); ws(); pos = pos + 1 -- ':'
        t[k] = value(); ws()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == '}' then return t end
      end
    elseif c == '[' then
      local t = {}; pos = pos + 1; ws()
      if s:sub(pos, pos) == ']' then pos = pos + 1; return t end
      while true do
        t[#t + 1] = value(); ws()
        local d = s:sub(pos, pos); pos = pos + 1
        if d == ']' then return t end
      end
    elseif c == '"' then return str()
    elseif s:sub(pos, pos + 3) == 'true' then pos = pos + 4; return true
    elseif s:sub(pos, pos + 4) == 'false' then pos = pos + 5; return false
    elseif s:sub(pos, pos + 3) == 'null' then pos = pos + 4; return nil
    else
      local num = s:match('^-?%d+%.?%d*[eE]?[-+]?%d*', pos)
      if not num or num == '' then error('bad JSON at ' .. pos) end
      pos = pos + #num
      return tonumber(num)
    end
  end
  return value()
end

-- ---------------------------------------------------------------- handles
local handles, ids, next_id = {}, {}, 1

function M.reset(root)
  handles, ids, next_id = { [0] = root }, {}, 1
  if root then ids[root] = 0 end
end

local function handle_of(obj)
  local h = ids[obj]
  if h then return h end
  h = next_id; next_id = next_id + 1
  handles[h], ids[obj] = obj, h
  return h
end

local function unwrap(v)
  if type(v) == 'table' then
    if v['$h'] ~= nil then return handles[v['$h']] end
    local t = {}
    for k, x in pairs(v) do t[k] = unwrap(x) end
    return t
  end
  return v
end

function M.handle(line)
  local ok, req = pcall(M.decode, line)
  if not ok or type(req) ~= 'table' then
    return '{"id":null,"ok":false,"e":' .. M.encode('bad request: ' .. tostring(req)) .. '}'
  end
  local id = M.encode(req.id)
  if req.op == 'ping' then return '{"id":' .. id .. ',"ok":true,"r":"pong"}' end
  if req.op == 'release' then
    local obj = handles[req.h]
    if obj and req.h ~= 0 then handles[req.h] = nil; ids[obj] = nil end
    return '{"id":' .. id .. ',"ok":true,"r":null}'
  end
  local obj = handles[req.h or 0]
  if obj == nil then return '{"id":' .. id .. ',"ok":false,"e":"stale handle"}' end
  local args = unwrap(req.a or {})
  local okc, res = pcall(function()
    local fn = obj[req.m]
    if fn == nil then error('no method ' .. tostring(req.m)) end
    local n = 0
    for k in pairs(args) do if type(k) == 'number' and k > n then n = k end end
    return fn(obj, (unpack or table.unpack)(args, 1, n))
  end)
  if not okc then return '{"id":' .. id .. ',"ok":false,"e":' .. M.encode(tostring(res)) .. '}' end
  return '{"id":' .. id .. ',"ok":true,"r":' .. M.encode(res, handle_of) .. '}'
end

function M.serve(root)
  M.reset(root)
  io.write('{"ready":' .. (root and 'true' or 'false') .. '}\n'); io.flush()
  while true do
    local line = io.read('*l')
    if line == nil then break end
    if line ~= '' then io.write(M.handle(line) .. '\n'); io.flush() end
  end
end

if HC_BRIDGE_TEST then return M end
local resolve = Resolve and Resolve() or nil
M.serve(resolve)
