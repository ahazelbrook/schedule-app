// The places of the night (app/gm/places.js, the night rebuild N1b) for the browser checks.
// A GM page with no phase in play opens in Before, whose left column is Preflight and Tonight, not the Roll. A check that works the console, the
// site or a pane starts its page in a place that lays them out, as the GM is when using them, through the page's own memory of the place:
//   await context.addInitScript(atPlace('score'))      the Score: the Roll on the left, The site the view (keys R T N I G B S J C D O still open any view)
// The memory holds only while the night's phase is the one it was stored with (here: none); a phase in play opens its own place, as on a real night.
// It is written once per tab (an init script runs again on every load; sessionStorage marks the tab): a reload keeps the place and view it moved to.
export const PLACES_KEY = 'b68.gm.places';
export const atPlace = (place, views) => ({
  content: 'try { if (!sessionStorage.getItem("b68.check.atPlace")) { sessionStorage.setItem("b68.check.atPlace", "1"); localStorage.setItem(' + JSON.stringify(PLACES_KEY) + ', ' +
    JSON.stringify(JSON.stringify({ v: 1, place, phase: '', views: views || {} })) + '); } } catch (e) { /* no storage */ }'
});
