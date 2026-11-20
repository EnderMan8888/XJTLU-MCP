import { it } from 'node:test'
import assert from 'node:assert/strict'
import { notificationContent } from '../src/renderer/src/lmc-notifications.ts'

it('formats the observed forum email wrapper without dropping the message or author', () => {
  const item = { title: 'DEMO101: Example announcement', source: 'mod_forum', body: 'DEMO101\n   »\n Forums\n »\n Announcements\n »\n Example announcement\n\n\n S\n\n Example announcement\n\n by Synthetic Teacher - Tuesday, 17 November 2026, 10:00\n\n\n Dear students,\n    Please check the course page.\n\nKeep this second paragraph.\n\n See this post in context\n\n Change your forum digest preferences' }
  const content = notificationContent(item)
  assert.equal(content.title, 'Example announcement')
  assert.equal(content.course, 'DEMO101')
  assert.equal(content.author, 'Synthetic Teacher')
  assert.equal(content.body, 'Dear students,\nPlease check the course page.\n\nKeep this second paragraph.')
  assert.equal(content.preview, 'Dear students, Please check the course page. Keep this second paragraph.')
  assert.doesNotMatch(content.body, /Forums|Synthetic Teacher|digest preferences|\n{3}/)
})

it('keeps unfamiliar notification content and bylines when the forum wrapper is absent', () => {
  const content = notificationContent({ title: 'Example notice', source: 'mod_forum', body: ' by Synthetic Teacher - an example\n\nImportant content with » symbols.\n\n\nKeep this.' })
  assert.equal(content.author, '')
  assert.match(content.body, /^by Synthetic Teacher/)
  assert.match(content.body, /Important content with » symbols/)
  assert.doesNotMatch(content.body, /\n{3}/)
})

it('separates assignment navigation from the confirmation body', () => {
  const content = notificationContent({ title: 'Assignment submission confirmation - Example', source: 'mod_assign', body: 'DEMO101 ->\n Assignment ->\n Example\n\nYour assignment has been submitted.\nPlease check its status.' })
  assert.equal(content.course, 'DEMO101')
  assert.equal(content.body, 'Your assignment has been submitted.\nPlease check its status.')
  assert.equal(content.canExpand, true)
})
