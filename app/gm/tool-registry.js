/* gm/tool-registry.js — the shell's one way into the 18 tools that used to open from the Menu (the night rebuild, N2).

   Plain script, UMD: it adds to window.B68GmTools (gm/tools.js, the tab registry) and is also usable under Node (it requires ./tools.js there). It must load AFTER
   gm/tools.js. It adds NO second global: `B68GmTools.get(id)` answers for a tool id as well as for a tab id (the ids never overlap: the tabs are console, prep, rules,
   location, scenes, score, chase, npc, downtime, cards, ipad, run).

   THE CONTRACT (N1b and N3 build against exactly this)
     B68GmTools.get(id)           -> { id, label, kind: 'tool', open(), close(), mounted() }  for a tool id below, else the tab entry of tools.js, else null
       open()     draw the tool into its sheet and show it. When the shell has bound the tool inline (B68GmWorkshop.inline(id, el, opts)) it draws into that container and
                  nothing else happens; when it has not, the tool opens in the right-edge sheet as it always did. Calling open() again redraws it. -> true | false (false: the
                  page is not ready, or the tool has nothing to draw with: the same answer the Menu line used to get)
       close()    hide the right-edge sheet; for a bound tool this calls the onClose the shell gave inline() and hides nothing
       mounted()  true while the tool is bound inline
     B68GmTools.toolIds()         -> the ids, in the order below
     B68GmTools.registerTool(id, def)   def: { label, open(), close?(), refresh? } (the page registers each tool once; registering an id again replaces it)
     B68GmTools.unregisterTool(id)      -> true when it was there
     B68GmTools.tool(id)          -> the same entry as get(id) but only for tools (null for a tab id)
     B68GmTools.register(def)     the tab registry's own, guarded: a def whose id is one of the 18 (or any tool registered) throws 'tab <id> is a tool'

   THE 18 (id -> controller -> how it opens; gm-page.js registers each next to where its instance is made)
     hardstart  B68GmHardStart.make(...)      hsInst()   .open()      preflight  B68GmPreflight.create(...)  pfInst()  .open()
     print      B68GmPrint.make(...)          prInst()   .open()      corkboard  B68GmCorkboard.make(...)    cbInst()  .open()
     montage    B68GmMontage.make(...)        mtInst()   .open()      practical  B68GmRoomDesk .practical()  rdInst().practical().open()
     phone      B68GmRoomDesk .phone()        trouble    B68GmRoomDesk .trouble()  canon / frontpage / absent  B68GmRoomDesk's desk-b31 controllers
     aftermath  B68GmAftermath.open(root)     debrief    B68GmDebrief.open(root)    board  B68GmBoard.open(root)
     castphoto  B68GmCastPhoto.open(root)     lair       B68GmLair.open(root)
     record     B68GmB29 .tool('record')      light      B68GmB29 .tool('light')
   (Each controller keeps its own toggle(); the registry does not use it, a shell shows and hides a bound tool by binding and unbinding.) */
(function (root, factory) {
  'use strict';
  var T = root && root.B68GmTools;
  if (!T && typeof module === 'object' && module && module.exports) { try { T = require('./tools.js'); } catch (e) { T = null; } }
  var M = factory(T, root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
})(typeof self !== 'undefined' ? self : this, function (T, W) {
  'use strict';
  var IDS = ['hardstart', 'preflight', 'print', 'corkboard', 'montage', 'practical', 'phone', 'trouble', 'canon', 'frontpage', 'absent', 'aftermath', 'debrief', 'board', 'castphoto', 'lair', 'record', 'light'];
  var LABELS = { hardstart: 'Hard start', preflight: 'Preflight', print: 'Print', corkboard: 'Corkboard', montage: 'Montage', practical: 'Practical speaker', phone: 'Ringing phone',
    trouble: 'Trouble desk', canon: 'Canon queue', frontpage: 'Front page', absent: 'Absent packet', aftermath: 'Aftermath show', debrief: 'Debrief', board: 'Opportunity board',
    castphoto: 'Cast photo', lair: 'The lair', record: 'Record the night', light: 'Light relay' };
  var ID_RE = /^[a-z][a-z0-9-]{0,31}$/;
  var tools = {};

  function ws() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
  function entry(id, def) {
    return {
      id: id, label: def.label || LABELS[id] || id, kind: 'tool',
      open: function () { try { return def.open() !== false; } catch (e) { if (W && W.console) W.console.error(e); return false; } },
      close: function () { try { if (typeof def.close === 'function') def.close(); } catch (e) { /* the tool's */ } },
      mounted: function () { var w = ws(); return !!(w && typeof w.bound === 'function' && w.bound(id)); }
    };
  }
  function registerTool(id, def) {
    id = String(id == null ? '' : id);
    if (!ID_RE.test(id)) throw new Error('tool id must be lowercase letters, digits and dashes: ' + id);
    if (!def || typeof def.open !== 'function') throw new Error('tool ' + id + ' needs an open()');
    if (T && typeof T.list === 'function') { for (var i = 0, l = T.list(); i < l.length; i++) if (l[i].id === id) throw new Error('tool ' + id + ' is a tab'); }
    tools[id] = entry(id, def);
    return tools[id];
  }
  function unregisterTool(id) { if (!tools[id]) return false; delete tools[id]; return true; }
  function tool(id) { return tools[id] || null; }
  function toolIds() { var out = IDS.filter(function (id) { return tools[id]; }); Object.keys(tools).forEach(function (id) { if (out.indexOf(id) < 0) out.push(id); }); return out; }

  if (T && !T.__toolRegistry) {
    var tabGet = T.get, tabRegister = T.register;
    T.__toolRegistry = true;
    T.get = function (id) { return tabGet(id) || tools[id] || null; };
    /* get() asks the tabs first, so a tab registered later under a tool's id would hide the tool without a word: register() refuses the 18 ids and any tool
       registered since (the same way registerTool refuses a tab's id) */
    if (typeof tabRegister === 'function') {
      T.register = function (def) {
        var id = def && typeof def === 'object' && def.id != null ? String(def.id) : '';
        if (id && (IDS.indexOf(id) >= 0 || tools[id])) throw new Error('tab ' + id + ' is a tool');
        return tabRegister.apply(T, arguments);
      };
    }
    T.tool = tool; T.toolIds = toolIds; T.registerTool = registerTool; T.unregisterTool = unregisterTool;
  }
  return { IDS: IDS, LABELS: LABELS, registerTool: registerTool, unregisterTool: unregisterTool, tool: tool, toolIds: toolIds };
});
