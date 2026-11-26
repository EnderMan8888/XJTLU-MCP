import { it } from 'node:test'
import assert from 'node:assert/strict'
import { OutlookMail } from '../src/providers/outlook-mail.ts'

const item = { ItemId: { Id: 'mail-demo', ChangeKey: 'unused' }, Subject: 'Demo', IsRead: false, Preview: 'Not in the result' }
const success = (data: object) => ({ Body: { ResponseMessages: { Items: [{ ResponseClass: 'Success', ResponseCode: 'NoError', ...data }] } } })

it('projects Exchange lists and details, retaining false and empty values', async () => {
  const mail = new OutlookMail(async action => action === 'FindItem'
    ? success({ RootFolder: { Items: [item], IncludesLastItemInRange: false, TotalItemsInView: 25, IndexedPagingOffset: 21 } })
    : success({ Items: [{ ...item, Body: { BodyType: 'Text', Value: '' } }] }))
  const page = await mail.list('inbox', 20, 1)
  assert.equal(page.nextOffset, 21)
  assert.equal(page.messages[0].isRead, false)
  assert.equal(page.messages[0].id, 'mail-demo')
  assert.doesNotMatch(JSON.stringify(page), /ChangeKey|Preview|unused/)
  assert.equal((await mail.get('mail-demo')).body, '')
  const malformed = new OutlookMail(async () => success({ RootFolder: { TotalItemsInView: 5, IncludesLastItemInRange: true } }))
  await assert.rejects(() => malformed.list('inbox', 0, 20), { code: 'mail_invalid_response' })
})

it('submits all recipient classes and requires an Exchange success response', async () => {
  const input = { to: ['to@example.com'], cc: ['cc@example.com'], bcc: ['bcc@example.com'], subject: 'Demo', body: 'Example' }
  const mail = new OutlookMail(async (action, payload) => {
    assert.equal(action, 'CreateItem')
    const { Body: body } = payload as { Body: { MessageDisposition: string; Items: Record<string, { EmailAddress: string }[]>[] } }
    assert.equal(body.MessageDisposition, 'SendAndSaveCopy')
    assert.deepEqual([body.Items[0].ToRecipients, body.Items[0].CcRecipients, body.Items[0].BccRecipients].map(list => list[0].EmailAddress),
      ['to@example.com', 'cc@example.com', 'bcc@example.com'])
    return success({})
  })
  await mail.send(input)
  const ambiguous = new OutlookMail(async () => ({}))
  await assert.rejects(() => ambiguous.send(input), { code: 'delivery_unknown' })
})

it('identifies the signed-in Inbox and requests HTML only for a formatted message', async () => {
  const requests: string[] = []
  const mail = new OutlookMail(async (action, payload) => {
    const body = (payload as { Body: { ItemShape?: { BodyType: string }; FolderIds?: { Id: string }[] } }).Body
    if (action === 'GetFolder') {
      assert.equal(body.FolderIds?.[0].Id, 'inbox')
      return success({ Folders: [{ FolderId: { Id: 'synthetic-folder-id' } }] })
    }
    const type = body.ItemShape?.BodyType
    requests.push(type ?? '')
    return success({ Items: [{ ...item, Body: { BodyType: type, Value: type === 'HTML' ? '<p><b>Demo</b></p>' : 'Demo' } }] })
  })
  assert.equal(await mail.inboxId(), 'synthetic-folder-id')
  assert.equal((await mail.get('mail-demo', 'HTML')).bodyType, 'html')
  assert.equal((await mail.get('mail-demo')).bodyType, 'text')
  assert.deepEqual(requests, ['HTML', 'Text'])
})
