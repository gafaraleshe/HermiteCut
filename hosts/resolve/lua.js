// HermiteCut — Fusion Lua snippets executed through comp:Execute()
'use strict';

// Converts a JS value into a Lua literal.
function toLua(v) {
    if (v === null || v === undefined) return 'nil';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') return isFinite(v) ? String(+v.toFixed(6)) : '0';
    if (typeof v === 'string') return JSON.stringify(v);
    if (Array.isArray(v)) return '{' + v.map(toLua).join(',') + '}';
    const parts = [];
    for (const k of Object.keys(v)) {
        const key = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : '[' + JSON.stringify(k) + ']';
        parts.push(key + '=' + toLua(v[k]));
    }
    return '{' + parts.join(',') + '}';
}

const LIB = String.raw`
local HC = {}
local function HC_ok(s) comp:SetData("HermiteCut.r", "__HCTOKEN__|OK:" .. tostring(s)) end
local function HC_fail(s) comp:SetData("HermiteCut.r", "__HCTOKEN__|ERR:" .. tostring(s)) end

local function HC_modOf(inp)
  local o = inp:GetConnectedOutput()
  if not o then return nil end
  local t = o:GetTool()
  if not t then return nil end
  return t, t:GetAttrs().TOOLS_RegID
end

function HC.tools(allIfNone)
  local sel = comp:GetToolList(true) or {}
  local n = 0
  for _ in pairs(sel) do n = n + 1 end
  if n == 0 and allIfNone then sel = comp:GetToolList(false) or {} end
  return sel
end

function HC.splines(tools)
  local seen, list = {}, {}
  local function scan(tool, depth)
    if depth > 4 or not tool then return end
    local ok, inputs = pcall(function() return tool:GetInputList() end)
    if not ok or not inputs then return end
    for _, inp in pairs(inputs) do
      local m, id = HC_modOf(inp)
      if m then
        local name = m:GetAttrs().TOOLS_Name
        if id == "BezierSpline" then
          if not seen[name] then seen[name] = true; list[#list + 1] = m end
        elseif not seen[name] then
          seen[name] = true
          scan(m, depth + 1)
        end
      end
    end
  end
  for _, t in pairs(tools) do scan(t, 0) end
  return list
end

function HC.sortedKeys(sp)
  local kf = sp:GetKeyFrames() or {}
  local ts = {}
  for t, k in pairs(kf) do
    if type(t) == "number" and type(k) == "table" and type(k[1]) == "number" then ts[#ts + 1] = t end
  end
  table.sort(ts)
  return kf, ts
end

-- Apply a cubic-bezier (x1,y1,x2,y2) to every segment between keyframes.
function HC.ease(sp, c)
  local kf, ts = HC.sortedKeys(sp)
  if #ts < 2 then return 0 end
  local out = {}
  for _, t in ipairs(ts) do out[t] = { kf[t][1] } end
  local n = 0
  for i = 1, #ts - 1 do
    local t0, t1 = ts[i], ts[i + 1]
    local v0, v1 = out[t0][1], out[t1][1]
    local dt, dv = t1 - t0, v1 - v0
    out[t0].RH = { t0 + c[1] * dt, v0 + c[2] * dv }
    out[t1].LH = { t0 + c[3] * dt, v0 + c[4] * dv }
    n = n + 1
  end
  if not out[ts[1]].LH then out[ts[1]].LH = { ts[1] - 1, out[ts[1]][1] } end
  if not out[ts[#ts]].RH then out[ts[#ts]].RH = { ts[#ts] + 1, out[ts[#ts]][1] } end
  sp:SetKeyFrames(out, true)
  return n
end

-- Replace each moving segment with a sampled bounce/overshoot curve.
function HC.bounce(sp, S)
  local kf, ts = HC.sortedKeys(sp)
  if #ts < 2 then return 0 end
  local N = #S - 1
  local function f(p)
    if p <= 0 then return S[1] end
    if p >= 1 then return S[#S] end
    local x = p * N
    local i = math.floor(x)
    local fr = x - i
    return S[i + 1] + (S[i + 2] - S[i + 1]) * fr
  end
  local out = {}
  for _, t in ipairs(ts) do out[t] = { kf[t][1], Flags = { Linear = true } } end
  local n = 0
  for i = 1, #ts - 1 do
    local t0, t1 = ts[i], ts[i + 1]
    local v0, v1 = kf[t0][1], kf[t1][1]
    if v0 ~= v1 and (t1 - t0) >= 2 then
      local dt = t1 - t0
      local fr = math.floor(t0) + 1
      while fr < t1 do
        local p = (fr - t0) / dt
        out[fr] = { v0 + (v1 - v0) * f(p), Flags = { Linear = true } }
        fr = fr + 1
      end
      n = n + 1
    end
  end
  sp:SetKeyFrames(out, true)
  return n
end

function HC.range()
  local a = comp:GetAttrs()
  local s = a.COMPN_RenderStart or a.COMPN_GlobalStart or 0
  local e = a.COMPN_RenderEnd or a.COMPN_GlobalEnd or 100
  return s, e
end

local function HC_setKeys(sp, keys)
  local tbl = {}
  for _, k in ipairs(keys) do
    local e = { k[2] }
    if k[3] then e.RH = { k[3], k[4] } end
    if k[5] then e.LH = { k[5], k[6] } end
    if k[7] then e.Flags = { Linear = true } end
    tbl[k[1]] = e
  end
  sp:SetKeyFrames(tbl, true)
end

local function HC_disconnect(inp)
  pcall(function() inp:ConnectTo() end)
end

local function HC_animNumber(inp, keys)
  local tool = inp:GetTool()
  local id = inp:GetAttrs().INPS_ID
  HC_disconnect(inp)
  tool[id] = comp:BezierSpline({})
  local m = HC_modOf(inp)
  if m then HC_setKeys(m, keys) end
end

-- Nodes created by the pre-release build were called "EK_Motion".
local LEGACY_MOTION = "EK_Motion"

function HC.findMotion()
  return comp:FindTool("HC_Motion") or comp:FindTool(LEGACY_MOTION)
end

function HC.ensureMotion()
  local mo = comp:FindToolByID("MediaOut")
  if not mo then error("This clip's Fusion comp has no MediaOut node") end
  local tr = comp:FindTool("HC_Motion")
  if not tr then
    tr = comp:FindTool(LEGACY_MOTION)
    if tr then tr:SetAttrs({ TOOLS_Name = "HC_Motion" }) end
  end
  if not tr then
    local src = mo.Input:GetConnectedOutput()
    tr = comp:AddTool("Transform", -32768, -32768)
    tr:SetAttrs({ TOOLS_Name = "HC_Motion" })
    if src then tr.Input:ConnectTo(src) end
    mo.Input:ConnectTo(tr.Output)
    if src then
      pcall(function()
        local flow = comp.CurrentFrame.FlowView
        local st = src:GetTool()
        local x, y = flow:GetPos(st)
        flow:SetPos(tr, x + 1, y)
      end)
    end
  end
  return tr
end

function HC.applyMotion(spec)
  local tr = HC.ensureMotion()
  for _, nm in ipairs({ "Size", "Angle", "Center" }) do HC_disconnect(tr[nm]) end
  tr:SetInput("Size", spec.baseSize or 1)
  tr:SetInput("Angle", 0)
  tr:SetInput("Center", { 0.5, 0.5 })
  if spec.size and #spec.size > 0 then HC_animNumber(tr.Size, spec.size) end
  if spec.angle and #spec.angle > 0 then HC_animNumber(tr.Angle, spec.angle) end
  if (spec.cx and #spec.cx > 0) or (spec.cy and #spec.cy > 0) then
    tr.Center = comp:XYPath({})
    local xy = HC_modOf(tr.Center)
    if xy then
      if spec.cx and #spec.cx > 0 then HC_animNumber(xy.X, spec.cx) else HC_disconnect(xy.X); xy:SetInput("X", 0.5) end
      if spec.cy and #spec.cy > 0 then HC_animNumber(xy.Y, spec.cy) else HC_disconnect(xy.Y); xy:SetInput("Y", 0.5) end
    end
  end
  pcall(function()
    tr:SetInput("MotionBlur", spec.blur and 1 or 0)
    if spec.blur then
      tr:SetInput("Quality", 8)
      tr:SetInput("ShutterAngle", 180)
    end
  end)
  pcall(function() tr:SetInput("Edges", spec.edges or 0) end)
end

function HC.removeMotion()
  local n = 0
  for _, name in ipairs({ "HC_Motion", LEGACY_MOTION }) do
    local tr = comp:FindTool(name)
    if tr then
      local src = tr.Input:GetConnectedOutput()
      local mo = comp:FindToolByID("MediaOut")
      if mo and src then mo.Input:ConnectTo(src) end
      tr:Delete()
      n = n + 1
    end
  end
  return n
end
`;

function wrap(body, undoName) {
    return LIB + '\n' +
        (undoName ? 'comp:StartUndo(' + JSON.stringify(undoName) + ')\n' : '') +
        'local __ok, __err = pcall(function()\n' + body + '\nend)\n' +
        (undoName ? 'comp:EndUndo(true)\n' : '') +
        'if not __ok then HC_fail(__err) end\n';
}

module.exports = {
    toLua,
    // Set inputs on the newest HermiteCut template instance in this comp
    // (the macro tool that has an input called `probe`).
    setTemplateInputs(probe, values) {
        return wrap(
            'local probe, vals = ' + toLua(probe) + ', ' + toLua(values) + '\n' +
            'local found = nil\n' +
            'for _, t in pairs(comp:GetToolList(false) or {}) do\n' +
            '  local ok, v = pcall(function() return t:GetInput(probe) end)\n' +
            '  if ok and v ~= nil then found = t end\n' +
            'end\n' +
            'if not found then HC_fail("template not found in this clip") return end\n' +
            'local n = 0\n' +
            'for k, v in pairs(vals) do if pcall(function() found:SetInput(k, v) end) then n = n + 1 end end\n' +
            'HC_ok(n)', 'HermiteCut settings');
    },
    info() {
        return wrap('local s, e = HC.range()\nHC_ok(s .. "," .. e)');
    },
    ease(curve, allIfNone) {
        return wrap(
            'local c = ' + toLua(curve) + '\n' +
            'local sp = HC.splines(HC.tools(' + toLua(!!allIfNone) + '))\n' +
            'local n = 0\nfor _, s in ipairs(sp) do n = n + HC.ease(s, c) end\n' +
            'HC_ok(n .. "," .. #sp)', 'HermiteCut Ease');
    },
    bounce(samples, allIfNone) {
        return wrap(
            'local S = ' + toLua(samples) + '\n' +
            'local sp = HC.splines(HC.tools(' + toLua(!!allIfNone) + '))\n' +
            'local n = 0\nfor _, s in ipairs(sp) do n = n + HC.bounce(s, S) end\n' +
            'HC_ok(n .. "," .. #sp)', 'HermiteCut Bounce');
    },
    motion(spec) {
        return wrap('HC.applyMotion(' + toLua(spec) + ')\nHC_ok("1")', 'HermiteCut Motion');
    },
    removeMotion() {
        return wrap('HC_ok(HC.removeMotion())', 'HermiteCut remove motion');
    }
};
