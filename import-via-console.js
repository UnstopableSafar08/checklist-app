// Run this in DevTools console on your logged-in todo_checklist site (http://localhost:3000).
    // It creates one type=checklist checklist + 31 todos via the app's own API.
(async () => {
  const ITEMS = [
  "Plan weekly priorities",
  "Review open pull requests",
  "Update project documentation",
  "Prepare demo for stakeholders",
  "Reply to pending emails",
  "Schedule team retrospective",
  "Back up important files",
  "Draft monthly report",
  "Organize shared drive",
  "Follow up with designer",
  "Test the new release build",
  "Share meeting notes",
]

  const clRes = await fetch('/api/checklists', {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ title: 'Sample Checklist', description: 'Imported from checklist-html', color: '#3b82f6', type: 'checklist' }),
  }).then(r => r.json());
  if (!clRes.checklist) throw new Error('checklist create failed: ' + JSON.stringify(clRes));
  const checklistId = clRes.checklist.id;
  console.log('checklist:', checklistId);

  for (let i = 0; i < ITEMS.length; i++) {
    const r = await fetch('/api/todos', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ title: ITEMS[i], checklistId, priority: 'medium', tags: [], order: i }),
    }).then(r => r.json());
    if (!r.todo) console.warn('todo failed:', ITEMS[i], r);
  }
  console.log('done — refresh the page');
})();
