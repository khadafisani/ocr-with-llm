const $ = (sel) => document.querySelector(sel)

const STAGE_LABELS = {
  queued: 'Waiting in queue',
  converting: 'Converting PDF to images',
  ocr: 'Reading text (glm-ocr)',
  extracting: 'Extracting data (gemma4)',
  saving: 'Saving',
  done: 'Done',
}

const expanded = new Set()
let lastSuccessIds = ''
let pollTimer = null

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
}

function fmtNumber(n, currency) {
  if (n == null) return '<span class="muted">–</span>'
  const s = Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 })
  return esc(currency ? `${currency} ${s}` : s)
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : ''
}

function fmtTime(d) {
  return d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : ''
}

function fmtDuration(ms) {
  if (ms == null) return ''
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

async function api(path, opts) {
  const res = await fetch(path, opts)
  const data = await res.json().catch(() => ({}))
  if (!res.ok && res.status !== 202) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

// ---------- Upload ----------

async function upload(fileList) {
  const files = [...fileList]
  if (!files.length) return
  const form = new FormData()
  files.forEach((f) => form.append('files', f))
  $('#uploadMsg').textContent = `Uploading ${files.length} file(s)…`
  try {
    const res = await fetch('/api/documents', { method: 'POST', body: form })
    const data = await res.json()
    const parts = []
    if (data.documents?.length) parts.push(`${data.documents.length} queued`)
    if (data.rejected?.length) parts.push(`rejected: ${data.rejected.map((r) => `${r.name} (${r.error})`).join(', ')}`)
    if (data.error) parts.push(data.error)
    $('#uploadMsg').textContent = parts.join(' · ')
  } catch (err) {
    $('#uploadMsg').textContent = `Upload failed: ${err.message}`
  }
  $('#fileInput').value = ''
  refresh()
}

const dropzone = $('#dropzone')
$('#fileInput').addEventListener('change', (e) => upload(e.target.files))
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over') })
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'))
dropzone.addEventListener('drop', (e) => {
  e.preventDefault()
  dropzone.classList.remove('over')
  upload(e.dataTransfer.files)
})

// ---------- Documents ----------

function stageText(doc) {
  if (doc.status === 'failed') return `<span class="error">Failed at ${esc(doc.error?.stage)}: ${esc(doc.error?.message)}</span>`
  let text = esc(STAGE_LABELS[doc.stage] || doc.stage)
  if (doc.stage === 'ocr' && doc.progress?.totalPages) {
    text += ` <span class="muted">page ${Math.min(doc.progress.page + 1, doc.progress.totalPages)}/${doc.progress.totalPages}</span>`
  }
  return text
}

function renderDocuments(docs) {
  const active = docs.filter((d) => d.status === 'queued' || d.status === 'processing').length
  $('#queueInfo').textContent = active ? `${active} in progress` : ''
  if (!docs.length) {
    $('#docRows').innerHTML = '<tr><td colspan="6" class="muted">No documents yet.</td></tr>'
    return
  }
  $('#docRows').innerHTML = docs
    .map((d) => {
      const busy = d.status === 'processing'
      return `<tr>
        <td><a href="/api/documents/${d._id}/file" target="_blank">${esc(d.originalName)}</a></td>
        <td><span class="badge ${d.status}">${d.status}</span></td>
        <td>${stageText(d)}</td>
        <td>${fmtTime(d.createdAt)}</td>
        <td>${fmtDuration(d.durationMs)}</td>
        <td><div class="actions">
          <button class="btn" data-action="ocr" data-id="${d._id}" data-name="${esc(d.originalName)}">OCR text</button>
          <button class="btn" data-action="retry" data-id="${d._id}" ${busy ? 'disabled' : ''}>Retry</button>
          <button class="btn" data-action="extract" data-id="${d._id}" ${busy ? 'disabled' : ''} title="Re-run only gemma4 using the saved OCR text">Re-extract</button>
          <button class="btn danger" data-action="delete" data-id="${d._id}" ${busy ? 'disabled' : ''}>Delete</button>
        </div></td>
      </tr>`
    })
    .join('')
}

$('#docRows').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]')
  if (!btn) return
  const { action, id, name } = btn.dataset
  try {
    if (action === 'ocr') {
      const doc = await api(`/api/documents/${id}`)
      $('#ocrTitle').textContent = `OCR text: ${name}`
      $('#ocrText').textContent = doc.ocrText || '(no OCR text yet)'
      $('#ocrDialog').showModal()
      return
    }
    if (action === 'retry') await api(`/api/documents/${id}/retry`, { method: 'POST' })
    if (action === 'extract') await api(`/api/documents/${id}/retry?stage=extract`, { method: 'POST' })
    if (action === 'delete') {
      if (!confirm(`Delete ${name || 'this document'} and its invoice?`)) return
      await api(`/api/documents/${id}`, { method: 'DELETE' })
    }
    refresh()
  } catch (err) {
    alert(err.message)
  }
})
$('#ocrClose').addEventListener('click', () => $('#ocrDialog').close())

// ---------- Invoices ----------

function contactText(c = {}) {
  return [c.name, c.phone, c.email].filter(Boolean).map(esc).join('<br>') || '<span class="muted">–</span>'
}

function detailRow(inv) {
  const items = inv.items?.length
    ? `<table>
        <thead><tr><th>#</th><th>Description</th><th class="num">Qty</th><th>Unit</th><th class="num">Price</th><th class="num">Total</th></tr></thead>
        <tbody>${inv.items
          .map((it) => `<tr>
            <td>${it.lineNo ?? ''}</td>
            <td>${esc(it.description)}</td>
            <td class="num">${fmtNumber(it.quantity)}</td>
            <td>${esc(it.unit)}</td>
            <td class="num">${fmtNumber(it.price)}</td>
            <td class="num">${fmtNumber(it.total)}</td>
          </tr>`)
          .join('')}</tbody>
      </table>`
    : '<p class="muted">No line items detected.</p>'

  const meta = [
    ['Customer', inv.customerName],
    ['Address', inv.contact?.address],
    ['Date (as printed)', inv.invoiceDateRaw],
    ['Subtotal', inv.subtotal != null ? fmtNumber(inv.subtotal, inv.currency) : null],
    ['Tax', inv.tax != null ? fmtNumber(inv.tax, inv.currency) : null],
    ['Source', inv.document ? `<a href="/api/documents/${inv.documentId}/file" target="_blank">${esc(inv.document.originalName)}</a>` : null],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<span><span class="muted">${k}:</span> ${k === 'Subtotal' || k === 'Tax' || k === 'Source' ? v : esc(v)}</span>`)
    .join('')

  const notes = inv.notes ? `<div class="notes"><strong>Notes</strong>\n${esc(inv.notes)}</div>` : ''
  return `<tr class="detail"><td colspan="7"><div class="meta">${meta}</div>${items}${notes}</td></tr>`
}

function renderInvoices(list) {
  if (!list.length) {
    $('#invoiceRows').innerHTML = '<tr><td colspan="7" class="muted">No invoices yet.</td></tr>'
    return
  }
  $('#invoiceRows').innerHTML = list
    .map((inv) => {
      const row = `<tr class="clickable" data-id="${inv._id}">
        <td>${esc(inv.supplierName) || '<span class="muted">–</span>'}</td>
        <td>${esc(inv.invoiceNo)}</td>
        <td>${esc(inv.invoiceLabel)}</td>
        <td>${fmtDate(inv.invoiceDate) || esc(inv.invoiceDateRaw)}</td>
        <td>${contactText(inv.contact)}</td>
        <td class="num">${fmtNumber(inv.grandTotal, inv.currency)}</td>
        <td class="num">${inv.items?.length ?? 0}${inv.notes ? ' 📝' : ''}</td>
      </tr>`
      return expanded.has(inv._id) ? row + detailRow(inv) : row
    })
    .join('')
}

let invoicesCache = []
$('#invoiceRows').addEventListener('click', (e) => {
  if (e.target.closest('a')) return
  const row = e.target.closest('tr.clickable')
  if (!row) return
  const id = row.dataset.id
  expanded.has(id) ? expanded.delete(id) : expanded.add(id)
  renderInvoices(invoicesCache)
})

async function loadInvoices() {
  invoicesCache = await api('/api/invoices')
  renderInvoices(invoicesCache)
}

// ---------- Polling ----------

async function refresh() {
  clearTimeout(pollTimer)
  try {
    const docs = await api('/api/documents')
    renderDocuments(docs)
    // Reload invoices only when the set of successful documents changes.
    const successIds = docs.filter((d) => d.status === 'success').map((d) => `${d._id}:${d.finishedAt}`).join(',')
    if (successIds !== lastSuccessIds) {
      lastSuccessIds = successIds
      await loadInvoices()
    }
    const active = docs.some((d) => d.status === 'queued' || d.status === 'processing')
    pollTimer = setTimeout(refresh, active ? 2000 : 10000)
  } catch (err) {
    $('#queueInfo').textContent = `Error: ${err.message}`
    pollTimer = setTimeout(refresh, 5000)
  }
}

refresh()
