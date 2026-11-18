-- HermiteCut launcher: Workspace > Scripts > HermiteCut
-- Opens the HermiteCut app (or brings it to the front). Installed by the
-- app's Setup screen into Fusion/Scripts/Utility.
local function exists(p)
  local f = io.open(p, 'r')
  if f then f:close(); return true end
  return false
end

if package.config:sub(1, 1) == '\\' then
  local la = os.getenv('LOCALAPPDATA') or ''
  local pf = os.getenv('ProgramFiles') or 'C:\\Program Files'
  for _, p in ipairs({ la .. '\\Programs\\HermiteCut\\HermiteCut.exe', pf .. '\\HermiteCut\\HermiteCut.exe' }) do
    if exists(p) then os.execute('start "" "' .. p .. '"'); return end
  end
else
  if exists('/Applications/HermiteCut.app') or exists(os.getenv('HOME') .. '/Applications/HermiteCut.app') then
    os.execute('open -a HermiteCut'); return
  end
end
print('HermiteCut is not installed. Download it from https://github.com/gafaraleshe/HermiteCut/releases/latest')
