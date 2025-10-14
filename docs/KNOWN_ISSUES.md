# Known Issues

## Live Sessions

### Monaco Editor Visual Update in Follow Mode

**Issue**: When an attendee is in Follow mode and the presenter executes a formfill action on a Monaco editor (e.g., PromQL query field), the editor **visually updates only if the attendee's browser window is focused**.

**Cause**: This is a Monaco editor limitation - Monaco does not update its visual display when the browser tab/window is not in focus. The value is actually being set in the underlying textarea, but Monaco's rendering engine waits until the window regains focus to update the display.

**Workaround**: Attendees should keep their browser window focused when following along with interactive tutorials that involve code editors.

**Status**: This is a limitation of the Monaco editor component, not a bug in Pathfinder. The action executes correctly and the step completion still works properly.

**Technical Details**:
- The formfill action triggers successfully
- The underlying textarea value is set correctly
- Monaco editor events are dispatched
- Step completion is marked correctly
- Only the visual rendering is delayed until window focus

**Example**: In the "Prometheus & Grafana 101" tutorial, when the presenter fills the PromQL query field, attendees will see the query appear in their editor once they click or focus on their browser window.

