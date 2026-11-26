import { z } from 'zod/v4'
import type { MailFolder, MailListPage, MailMessage, MailSummary, OutgoingMail } from '../shared/mail.ts'

export class MailError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

const itemId = z.object({ Id: z.string().min(1), ChangeKey: z.string().optional() })
const mailbox = z.object({ Name: z.string().nullish(), EmailAddress: z.string().nullish() })
const mailItem = z.object({
  ItemId: itemId, Subject: z.string().nullish(), From: z.object({ Mailbox: mailbox }).nullish(),
  Sender: z.object({ Mailbox: mailbox }).nullish(), DateTimeReceived: z.string().nullish(),
  DateTimeSent: z.string().nullish(), IsRead: z.boolean().nullish(), HasAttachments: z.boolean().nullish()
})
const mailDetail = mailItem.extend({
  Body: z.object({ Value: z.string().nullish(), BodyType: z.enum(['Text', 'HTML']).nullish() }).nullable(),
  ToRecipients: z.array(mailbox).nullish(), CcRecipients: z.array(mailbox).nullish(), BccRecipients: z.array(mailbox).nullish()
})
const responseEnvelope = z.object({ Body: z.object({ ResponseMessages: z.object({ Items: z.array(z.object({
  ResponseClass: z.string(), ResponseCode: z.string(), Items: z.unknown().optional(), RootFolder: z.unknown().optional(), Folders: z.unknown().optional()
})).length(1) }) }) })
const folderResult = z.object({
  IncludesLastItemInRange: z.boolean(), IndexedPagingOffset: z.number().int().nonnegative().optional(),
  TotalItemsInView: z.number().int().nonnegative(), Items: z.array(mailItem).nullish()
})

export type MailAction = 'FindItem' | 'GetFolder' | 'GetItem' | 'CreateItem'
export type OutlookRequest = (action: MailAction, payload: object) => Promise<unknown>
const typed = <T extends object>(type: string, fields: T) => ({ __type: `${type}:#Exchange`, ...fields })
const property = (name: string) => typed('PropertyUri', { FieldURI: name })
const folderId = (id: string) => typed('DistinguishedFolderId', { Id: id })
const displayAddress = (address: z.infer<typeof mailbox> | null | undefined) => address
  ? { name: address.Name ?? null, address: address.EmailAddress ?? null } : null
const listItem = (item: z.infer<typeof mailItem>): MailSummary => ({
  id: item.ItemId.Id, subject: item.Subject ?? '', from: displayAddress(item.From?.Mailbox ?? item.Sender?.Mailbox),
  receivedAt: item.DateTimeReceived ?? null, sentAt: item.DateTimeSent ?? null,
  isRead: item.IsRead ?? null, hasAttachments: item.HasAttachments ?? null
})

function failedResponse(code: string): never {
  if (['ErrorInvalidClientAccessToken', 'ErrorInvalidCanary', 'ErrorInvalidUserContext', 'ErrorInvalidExchangeImpersonationHeader', 'ErrorNonExistentMailbox'].includes(code)) {
    throw new MailError('not_connected', '邮箱会话已失效或尚未开通，请在桌面应用重新登录。')
  }
  if (['ErrorItemNotFound', 'ErrorInvalidIdMalformed', 'ErrorInvalidIdEmpty'].includes(code)) throw new MailError('mail_not_found', '邮箱找不到此邮件，请重新获取列表。')
  if (['ErrorAccessDenied', 'ErrorSendAsDenied'].includes(code)) throw new MailError('mail_access_denied', 'Exchange 拒绝了该邮箱操作，请核对当前登录账号和权限。')
  throw new MailError('mail_rejected', 'Exchange 拒绝了该邮件操作。')
}

export class OutlookMail {
  private readonly request: OutlookRequest
  constructor(request: OutlookRequest) { this.request = request }

  private async call(action: MailAction, body: object) {
    const result = responseEnvelope.safeParse(await this.request(action, typed(`${action}JsonRequest`, {
      Header: typed('JsonRequestHeaders', { RequestServerVersion: 'Exchange2013' }), Body: typed(`${action}Request`, body)
    })))
    if (!result.success) throw new MailError('mail_invalid_response', '邮箱返回了无法识别的响应。')
    const response = result.data.Body.ResponseMessages.Items[0]
    if (response.ResponseClass !== 'Success' || response.ResponseCode !== 'NoError') failedResponse(response.ResponseCode)
    return response
  }

  async list(folder: MailFolder, offset: number, limit: number): Promise<MailListPage> {
    const result = await this.call('FindItem', {
      ItemShape: typed('ItemResponseShape', { BaseShape: 'IdOnly' }),
      ParentFolderIds: [folderId(folder)], Traversal: 'Shallow', ShapeName: 'MailListItem',
      Paging: typed('IndexedPageView', { BasePoint: 'Beginning', Offset: offset, MaxEntriesReturned: limit }),
      ViewFilter: 'All', SortOrder: [typed('SortResults', { Order: 'Descending', Path: property(folder === 'inbox' ? 'DateTimeReceived' : 'DateTimeSent') })]
    })
    const page = folderResult.safeParse(result.RootFolder)
    if (!page.success || !page.data.Items && page.data.TotalItemsInView !== 0) throw new MailError('mail_invalid_response', '邮箱返回了无法识别的邮件列表。')
    const { Items: items, IncludesLastItemInRange: last, IndexedPagingOffset: next, TotalItemsInView: total } = page.data
    const messages = (items ?? []).map(listItem)
    const nextOffset = next ?? offset + messages.length
    if (!last && (!messages.length || nextOffset <= offset)) throw new MailError('mail_invalid_response', '邮箱返回了无效的分页位置。')
    return { folder, messages, total, nextOffset: last ? null : nextOffset }
  }

  async inboxId(): Promise<string> {
    const response = await this.call('GetFolder', {
      FolderShape: typed('FolderResponseShape', { BaseShape: 'IdOnly' }),
      FolderIds: [folderId('inbox')]
    })
    const folders = z.array(z.object({ FolderId: itemId })).length(1).safeParse(response.Folders)
    const id = folders.success ? folders.data[0].FolderId.Id : ''
    if (id.length < 16 || id.length > 4096) throw new MailError('mail_archive_identity', '暂无法确认用于存储的邮箱账号。')
    return id
  }

  async get(id: string, bodyType: 'Text' | 'HTML' = 'Text'): Promise<MailMessage> {
    const response = await this.call('GetItem', {
      ItemShape: typed('ItemResponseShape', { BaseShape: 'Default', BodyType: bodyType, AdditionalProperties: [
        'Body', 'From', 'ToRecipients', 'CcRecipients', 'BccRecipients', 'DateTimeReceived', 'DateTimeSent', 'IsRead', 'HasAttachments'
      ].map(property) }),
      ItemIds: [typed('ItemId', { Id: id })]
    })
    const result = z.array(mailDetail).length(1).safeParse(response.Items)
    if (!result.success) throw new MailError('mail_invalid_response', '邮箱返回了无法识别的邮件正文。')
    const [item] = result.data
    return { ...listItem(item), body: item.Body?.Value ?? '', bodyType: item.Body?.BodyType === 'HTML' ? 'html' : 'text',
      to: (item.ToRecipients ?? []).map(displayAddress), cc: (item.CcRecipients ?? []).map(displayAddress),
      bcc: (item.BccRecipients ?? []).map(displayAddress) }
  }

  async send(message: OutgoingMail): Promise<void> {
    const recipients = (addresses: string[]) => addresses.map(address => typed('EmailAddressWrapper', { EmailAddress: address, RoutingType: 'SMTP' }))
    try {
      await this.call('CreateItem', {
        MessageDisposition: 'SendAndSaveCopy',
        Items: [typed('Message', {
          Subject: message.subject, Body: typed('BodyContentType', { BodyType: 'Text', Value: message.body }),
          ToRecipients: recipients(message.to), CcRecipients: recipients(message.cc ?? []), BccRecipients: recipients(message.bcc ?? [])
        })]
      })
    } catch (error) {
      if (error instanceof MailError && ['not_connected', 'send_disabled', 'mail_rejected', 'mail_access_denied'].includes(error.code)) throw error
      throw new MailError('delivery_unknown', '未收到 Exchange 的发送确认。请先查看已发送邮件，避免重复发送。')
    }
  }
}
