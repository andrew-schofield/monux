import { format as strftime } from 'date-fns'
import undefsafe = require('undefsafe')

import {
  Account,
  Amount,
  IAmountOptions,
  ICurrency,
  Merchant,
  Monzo
} from './'

export interface IMonzoApiTransaction {
  [propName: string]: any
}

export default class Transaction {
  private monzo: Monzo | undefined
  private acc: Account | undefined
  private tx: IMonzoApiTransaction
  private index: number

  constructor(monzo: Monzo | undefined, acc: Account | undefined, tx: IMonzoApiTransaction, index = -1) {
    this.monzo = monzo
    this.acc = acc
    this.tx = tx
    this.index = index
  }

  get amount(): Amount {
    let opts: IAmountOptions = {
      raw: this.tx.amount,
      currency: this.tx.currency
    }

    // if foreign currency
    if (this.tx.local_currency !== this.tx.currency) {
      opts = {
        ...opts,
        localRaw: this.tx.local_amount,
        localCurrency: this.tx.local_currency
      }
    }

    return new Amount(opts)
  }

  public async annotate(key: string, val: string) {
    if (!this.monzo) throw new Error('Monzo account is undefined')

    const metaKey = `metadata[${key}]`

    try {
      return await this.monzo
        .request(`/transactions/${this.id}`, {
          [metaKey]: val
        }, 'PATCH')
    } catch (err) {
      console.error(err)
    }

  }

  get attachments() {
    return undefsafe(this, 'tx.attachments')
  }

  public async requestAttachmentUpload(contentType = 'image/jpeg') {
    if (!this.monzo) throw new Error('Monzo account is undefined')

    return await this.monzo
      .request('/attachment/upload', {
        file_name: 'monux-attachment.jpg',
        file_type: contentType
      }, 'POST')
  }

  public async registerAttachment(fileUrl: string, contentType = 'image/jpeg') {
    if (!this.monzo) throw new Error('Monzo account is undefined')

    return await this.monzo
      .request('/attachment/register', {
        external_id: this.tx.id,
        file_url: fileUrl,
        file_type: contentType
      }, 'POST')
  }

  public async deregisterAttachment(attachmentId: string) {
    if (!this.monzo) throw new Error('Monzo account is undefined')

    return await this.monzo
      .request('/attachment/deregister', {
        id: attachmentId
      }, 'POST')
  }

  get balance(): Amount {
    const opts: IAmountOptions = {
      raw: this.tx.account_balance,
      currency: this.tx.currency
    }

    return new Amount(opts)
  }

  get category() {
    let raw = this.tx.category
    raw = raw.replace('mondo', 'monzo')

    let formatted = raw
    formatted = formatted.replace('_', ' ')

    return {
      raw,
      formatted,
      toString: () => raw
    }
  }

  get created(): Date {
    return new Date(this.tx.created)
  }

  get declined(): boolean {
    return 'decline_reason' in this.tx
  }

  get declineReason(): string {
    return this.declined ? this.tx.decline_reason.replace('_', ' ').toLowerCase() : ''
  }

  get description(): string {
    return this.tx.description
  }

  get displayName(): string {
    if (this.merchant.name) return this.merchant.name
    else return this.description
  }

  get hidden(): boolean {
    if ('monux_hidden' in this.tx.metadata) {
      return this.tx.metadata.monux_hidden !== 'false'
    } else return false
  }

  get icon(): string {
    if ('is_topup' in this.tx.metadata && this.tx.metadata.is_topup) {
      return './icons/topup.png'
    }

    if (this.tx.counterparty && 'user_id' in this.tx.counterparty) {
      return './icons/peer.png'
    }

    if (this.merchant.logo) return this.merchant.logo

    return this.iconFallback
  }

  get iconFallback(): string {
    return `./icons/${this.tx.category}.png`
  }

  get id(): string {
    return this.tx.id
  }

  get is() {
    const cash = this.tx.category === 'cash'
    const zero = +this.tx.amount === 0

    const metaAction = zero && !this.inSpending

    return {
      metaAction,
      cash,
      zero
    }
  }

  get inSpending(): boolean {
    return this.tx.include_in_spending || false
  }

  get location(): string | undefined {
    if (undefsafe(this, 'tx.merchant.online')) {
      return 'Online'
    } else {
      return undefsafe(this, 'tx.merchant.address.short_formatted')
    }
  }

  get merchant(): Merchant {
    return new Merchant(this.tx.merchant)
  }

  get notes(): object {
    return {
      toString: () => this.tx.notes,
      short: this.tx.notes.split('\n')[0],
      full: this.tx.notes
    }
  }

  public async setNotes(val: string): Promise<string> {
    const res = await this.annotate('notes', val)

    this.tx.notes = res.transaction.notes
    return this.tx.notes
  }

  get online(): boolean {
    return !!undefsafe(this, 'tx.merchange.online')
  }

  get pending(): boolean {
    // declined transactions are never pending
    if (this.declined) return false

    // cash is never pending
    if (this.is.cash) return false

    // all income and zero amounts seems to be exempt
    // could change when currect accounts release
    if (this.tx.amount >= 0) return false

    // if settled does not exists
    if (!('settled' in this.tx)) return true

    // or if settled field is empty
    if ('settled' in this.tx && !this.tx.settled.trim()) return true

    // assume transaction is not pending
    return false
  }

  get settled(): string {
    if (this.pending) return 'Pending'
    else return `Settled: ${strftime(new Date(this.tx.settled), 'h:mma - Do MMMM YYYY')}`
  }
}
