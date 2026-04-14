import { useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, Popup, TileLayer, useMapEvents } from 'react-leaflet'
import L from 'leaflet'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

function createMarkerIcon(color = '#4f8cff', iconText = '•') {
  return L.divIcon({
    className: '',
    html: `
      <div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;background:${color};border:2px solid white;box-shadow:0 6px 18px rgba(0,0,0,.35);color:white;font-weight:800;font-size:14px;line-height:1;">
        ${String(iconText || '•').slice(0, 2)}
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14],
  })
}

function ClickHandler({ onMapClick }) {
  useMapEvents({
    click(event) {
      onMapClick(event.latlng)
    },
  })
  return null
}

const makeEmptyCategory = (title = 'Nuovo tab') => ({
  id: null,
  title,
  modules: [],
  content: '',
  table_data: { columns: [], rows: [] },
  nocodb: { table_id: '', table_name: '', available_columns: [], visible_columns: [], filters: [] },
  pending_image_files: [],
  pending_document_files: [],
})

const normalizeCategoryDraft = (category) => ({
  id: category?.id ?? null,
  title: category?.title || 'Nuovo tab',
  modules: ensureCategoryModules(category),
  content: category?.content || '',
  table_data: {
    columns: Array.isArray(category?.table_data?.columns) ? category.table_data.columns : [],
    rows: Array.isArray(category?.table_data?.rows) ? category.table_data.rows : [],
  },
  nocodb: {
    table_id: category?.nocodb?.table_id || '',
    table_name: category?.nocodb?.table_name || '',
    available_columns: Array.isArray(category?.nocodb?.available_columns) ? category.nocodb.available_columns : [],
    visible_columns: Array.isArray(category?.nocodb?.visible_columns) ? category.nocodb.visible_columns : [],
    filters: Array.isArray(category?.nocodb?.filters) ? category.nocodb.filters.filter((item) => item?.field || item?.value) : [],
  },
  pending_image_files: [],
  pending_document_files: [],
})

const sanitizeCategoriesForApi = (categories) => categories.map((category) => {
  const modules = ensureCategoryModules(category)
  const availableColumns = Array.isArray(category?.nocodb?.available_columns) ? category.nocodb.available_columns.filter(Boolean) : []
  const visibleColumns = Array.isArray(category?.nocodb?.visible_columns) ? category.nocodb.visible_columns.filter(Boolean) : []
  const filters = Array.isArray(category?.nocodb?.filters)
    ? category.nocodb.filters
      .map((item) => ({
        field: String(item?.field || '').trim(),
        op: String(item?.op || 'eq').trim() || 'eq',
        value: String(item?.value || '').trim(),
      }))
      .filter((item) => item.field && item.value !== '')
    : []

  return {
    id: category?.id ?? undefined,
    title: category.title,
    modules,
    content: modules.includes('description') ? category.content : '',
    table_data: {
      columns: Array.isArray(category?.table_data?.columns) ? category.table_data.columns.filter(Boolean) : [],
      rows: Array.isArray(category?.table_data?.rows) ? category.table_data.rows : [],
    },
    nocodb: modules.includes('nocodb') && category?.nocodb?.table_id
      ? {
          table_id: category.nocodb.table_id,
          table_name: category.nocodb.table_name || '',
          available_columns: availableColumns,
          visible_columns: visibleColumns,
          filters,
        }
      : { table_id: '', table_name: '', available_columns: [], visible_columns: [], filters: [] },
  }
})

const isImageAttachment = (attachment) => (attachment.content_type || '').startsWith('image/')
const isPdfAttachment = (attachment) => (attachment.content_type || '').includes('pdf')
const isDocumentAttachment = (attachment) => !isImageAttachment(attachment)

const initialLocationForm = {
  name: '',
  description: '',
  latitude: '',
  longitude: '',
  marker_color: '#4f8cff',
  marker_icon: '🏗️',
  categories: [],
}

const initialUserForm = {
  username: '',
  email: '',
  password: '',
  role: 'viewer',
  is_active: true,
}

const initialLoginForm = {
  username: 'admin',
  password: 'admin123456',
}


const markerIconOptions = [
  { value: '🏗️', label: 'Infrastruttura' },
  { value: '🏢', label: 'Palazzo' },
  { value: '🏠', label: 'Casa' },
  { value: '🏭', label: 'Industria' },
  { value: '⚡', label: 'Energia' },
  { value: '🛡️', label: 'Sicurezza' },
  { value: '📡', label: 'Comunicazioni' },
  { value: '🚢', label: 'Porto' },
  { value: '✈️', label: 'Aeroporto' },
  { value: '🏥', label: 'Sanità' },
  { value: '🏛️', label: 'Istituzione' },
  { value: '📦', label: 'Supply chain' },
]

const categoryModuleOptions = [
  { value: 'description', label: 'Descrizione' },
  { value: 'images', label: 'Foto (Slider)' },
  { value: 'documents', label: 'Documenti' },
  { value: 'nocodb', label: 'Tabella NocoDB' },
]

function inferCategoryModules(category, attachments = []) {
  const modules = new Set(category?.modules || [])
  if ((category?.content || '').trim()) modules.add('description')
  if (category?.nocodb?.table_id) modules.add('nocodb')
  if ((attachments || []).some(isImageAttachment)) modules.add('images')
  if ((attachments || []).some((item) => !isImageAttachment(item))) modules.add('documents')
  return categoryModuleOptions.map((item) => item.value).filter((value) => modules.has(value))
}

function ensureCategoryModules(category, attachments = []) {
  const modules = inferCategoryModules(category, attachments)
  return modules
}

function MarkerStyleRow({ color, icon, onColorChange, onIconChange, disabled = false }) {
  return (
    <div className="marker-style-row">
      <label>
        Colore puntatore
        <input type="color" value={color} onChange={(e) => onColorChange(e.target.value)} disabled={disabled} />
      </label>
      <label>
        Icona
        <select value={icon} onChange={(e) => onIconChange(e.target.value)} disabled={disabled}>
          {markerIconOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.value} {option.label}</option>
          ))}
        </select>
      </label>
      <div className="marker-style-preview">
        <span className="muted compact-text">Anteprima</span>
        <div className="marker-preview">
          <div className="marker-preview-dot marker-preview-dot-large" style={{ background: color }}>
            {icon || '•'}
          </div>
        </div>
      </div>
    </div>
  )
}

const navItems = [
  { key: 'home', icon: '◎', label: 'Mappa globale', roles: ['admin', 'editor', 'viewer'] },
  { key: 'new-point', icon: '+', label: 'Nuovo punto', roles: ['admin', 'editor'] },
  { key: 'points', icon: '🗂', label: 'Gestione punti', roles: ['admin', 'editor', 'viewer'] },
  { key: 'search', icon: '⌕', label: 'Ricerca', roles: ['admin', 'editor', 'viewer'] },
  { key: 'settings', icon: '⚙', label: 'Utenti, allegati e impostazioni', roles: ['admin', 'editor', 'viewer'] },
]

function SectionCard({ title, subtitle, children, aside }) {
  return (
    <section className="panel section-card">
      <div className="section-card-header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="muted compact-text">{subtitle}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function EmptyState({ title, text }) {
  return (
    <div className="panel empty-state">
      <h2>{title}</h2>
      <p className="muted compact-text">{text}</p>
    </div>
  )
}

function LoginScreen({ form, setForm, onSubmit, status, loading }) {
  return (
    <div className="login-shell">
      <div className="panel login-card">
        <div>
          <h1>Geo Intel Service</h1>
          <p className="muted compact-text">Accesso obbligatorio. Inserisci le credenziali per entrare nella piattaforma.</p>
        </div>
        <form onSubmit={onSubmit}>
          <label>
            Username
            <input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required />
          </label>
          <label>
            Password
            <input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required />
          </label>
          <button type="submit" className="full-width" disabled={loading}>{loading ? 'Accesso...' : 'Accedi'}</button>
        </form>
        <div className="sub-card compact-text">
          <strong>Credenziali iniziali</strong>
          <div className="clean-list">
            <div>admin / admin123456</div>
            <div>editor / editor123456</div>
            <div>viewer / viewer123456</div>
          </div>
        </div>
        {status ? <div className="status-banner">{status}</div> : null}
      </div>
    </div>
  )
}

export default function App() {
  const [page, setPage] = useState('home')
  const [status, setStatus] = useState('')
  const [statusTone, setStatusTone] = useState('info')
  const [stats, setStats] = useState({ locations: 0, attachments: 0, users: 0, categories: 0 })
  const [locations, setLocations] = useState([])
  const [selectedLocationId, setSelectedLocationId] = useState(null)
  const [homeDetailsOpen, setHomeDetailsOpen] = useState(false)

  useEffect(() => {
    if (!status) return undefined
    const timer = window.setTimeout(() => {
      setStatus('')
      setStatusTone('info')
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [status])

  function showStatus(message, tone = 'success') {
    showStatus(message, 'info')
    setStatusTone(tone)
  }

  const [locationForm, setLocationForm] = useState(initialLocationForm)
  const [managementForm, setManagementForm] = useState(initialLocationForm)
  const [activeCreateTab, setActiveCreateTab] = useState(0)
  const [activeEditTab, setActiveEditTab] = useState(0)
  const [activeInfoTab, setActiveInfoTab] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [users, setUsers] = useState([])
  const [userForm, setUserForm] = useState(initialUserForm)
  const [editingUserId, setEditingUserId] = useState(null)
  const [attachments, setAttachments] = useState([])
  const [attachmentLocationId, setAttachmentLocationId] = useState('')
  const [attachmentCategoryId, setAttachmentCategoryId] = useState('')
  const [attachmentFile, setAttachmentFile] = useState(null)
  const [locationImageFile, setLocationImageFile] = useState(null)
  const [managementImageFile, setManagementImageFile] = useState(null)
  const [nocodbTables, setNocodbTables] = useState([])
  const [nocodbColumnsByTable, setNocodbColumnsByTable] = useState({})
  const [nocodbDataByCategory, setNocodbDataByCategory] = useState({})
  const [nocodbLoadingByCategory, setNocodbLoadingByCategory] = useState({})
  const [nocodbErrorByCategory, setNocodbErrorByCategory] = useState({})
  const [activeImageIndexByCategory, setActiveImageIndexByCategory] = useState({})
  const [activeDocumentIndexByCategory, setActiveDocumentIndexByCategory] = useState({})
  const [loginForm, setLoginForm] = useState(initialLoginForm)
  const [token, setToken] = useState(() => localStorage.getItem('geo_token') || '')
  const [currentUser, setCurrentUser] = useState(null)
  const [authLoading, setAuthLoading] = useState(Boolean(localStorage.getItem('geo_token')))
  const [loginLoading, setLoginLoading] = useState(false)
  const importInputRef = useRef(null)

  const mapCenter = useMemo(() => [20, 0], [])
  const selectedLocation = locations.find((item) => item.id === selectedLocationId) || null
  const selectedLocationCategories = selectedLocation?.categories || []
  const canEdit = currentUser && ['admin', 'editor'].includes(currentUser.role)
  const isAdmin = currentUser?.role === 'admin'
  const availableNavItems = navItems.filter((item) => !currentUser || item.roles.includes(currentUser.role))

  function applyLocationToEditForm(location) {
    if (!location) {
      setManagementForm(initialLocationForm)
      return
    }
    setManagementForm({
      name: location.name || '',
      description: location.description || '',
      latitude: String(location.latitude ?? ''),
      longitude: String(location.longitude ?? ''),
      marker_color: location.marker_color || '#4f8cff',
      marker_icon: location.marker_icon || '🏗️',
      categories: (location.categories || []).map((item) => normalizeCategoryDraft(item)),
    })
    setActiveEditTab(0)
    setManagementImageFile(null)
  }

  function logout(message = 'Sessione chiusa.') {
    localStorage.removeItem('geo_token')
    setToken('')
    setCurrentUser(null)
    setLocations([])
    setAttachments([])
    setUsers([])
    setStats({ locations: 0, attachments: 0, users: 0, categories: 0 })
    setPage('home')
    setStatus(message)
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {})
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    })
    if (!response.ok) {
      let detail = 'Richiesta non riuscita'
      try {
        const body = await response.json()
        detail = body.detail || JSON.stringify(body)
      } catch {
        detail = response.statusText || detail
      }
      if (response.status === 401) {
        logout('Sessione scaduta o non valida. Effettua di nuovo il login.')
      }
      throw new Error(detail)
    }
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      return response.json()
    }
    return response
  }

  async function loadStats() {
    const data = await api('/stats')
    setStats(data)
  }

  async function loadLocations() {
    const data = await api('/locations')
    setLocations(data)
    if (data.length > 0) {
      const preferredId = data.some((item) => item.id === selectedLocationId) ? selectedLocationId : data[0].id
      setSelectedLocationId(preferredId)
      const target = data.find((item) => item.id === preferredId) || data[0]
      applyLocationToEditForm(target)
      setAttachmentLocationId(String(preferredId))
    } else {
      setSelectedLocationId(null)
      applyLocationToEditForm(null)
      setAttachmentLocationId('')
    }
  }

  async function loadUsers() {
    if (!isAdmin) {
      setUsers([])
      return
    }
    const data = await api('/users')
    setUsers(data)
  }

  async function loadNocodbTables() {
    try {
      const data = await api('/nocodb/tables')
      setNocodbTables(data)
      setNocodbColumnsByTable(Object.fromEntries((data || []).map((item) => [item.id, item.columns || []])))
      setNocodbErrorByCategory((prev) => ({ ...prev, __config__: '' }))
    } catch (error) {
      setNocodbTables([])
      setNocodbErrorByCategory((prev) => ({ ...prev, __config__: error.message }))
    }
  }

  async function loadNocodbColumns(tableId) {
    if (!tableId) return []
    const cached = nocodbColumnsByTable[tableId]
    if (Array.isArray(cached) && cached.length) return cached
    const data = await api(`/nocodb/tables/${tableId}/columns`)
    const columns = Array.isArray(data?.columns) ? data.columns : (Array.isArray(data) ? data : [])
    setNocodbColumnsByTable((prev) => ({ ...prev, [tableId]: columns }))
    return columns
  }

  async function loadNocodbRows(categoryId, nocodbConfig) {
    if (!categoryId || !nocodbConfig?.table_id) return
    setNocodbLoadingByCategory((prev) => ({ ...prev, [categoryId]: true }))
    setNocodbErrorByCategory((prev) => ({ ...prev, [categoryId]: '' }))
    try {
      const data = await api(`/nocodb/tables/${nocodbConfig.table_id}/rows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          visible_columns: nocodbConfig.visible_columns || [],
          filters: nocodbConfig.filters || [],
          limit: 25,
        }),
      })
      setNocodbDataByCategory((prev) => ({ ...prev, [categoryId]: data }))
    } catch (error) {
      setNocodbErrorByCategory((prev) => ({ ...prev, [categoryId]: error.message }))
    } finally {
      setNocodbLoadingByCategory((prev) => ({ ...prev, [categoryId]: false }))
    }
  }

  async function loadAttachments(locationId = '') {
    const suffix = locationId ? `?location_id=${locationId}` : ''
    const data = await api(`/attachments${suffix}`)
    setAttachments(data)
  }

  async function refreshAll() {
    const tasks = [loadStats(), loadLocations(), loadAttachments()]
    if (isAdmin) tasks.push(loadUsers())
    await Promise.all(tasks)
  }

  useEffect(() => {
    if (!token) {
      setAuthLoading(false)
      return
    }
    setAuthLoading(true)
    fetch(`${API_BASE_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Autenticazione non valida')
        return response.json()
      })
      .then((user) => {
        setCurrentUser(user)
        setStatus(''); setStatusTone('info')
      })
      .catch(() => logout('Sessione non valida. Effettua di nuovo il login.'))
      .finally(() => setAuthLoading(false))
  }, [token])

  useEffect(() => {
    if (!currentUser) return
    if (!availableNavItems.some((item) => item.key === page)) {
      setPage('home')
    }
  }, [currentUser?.role])

  useEffect(() => {
    if (!currentUser) return
    refreshAll().catch((error) => showStatus(error.message, 'error'))
  }, [currentUser?.role])
  useEffect(() => {
    if (!currentUser || !canEdit) return
    loadNocodbTables().catch(() => {})
  }, [currentUser?.role, canEdit])

  useEffect(() => {
    const category = selectedLocation?.categories?.[Math.min(activeInfoTab, (selectedLocation?.categories?.length || 1) - 1)]
    if (!category?.id || !category?.nocodb?.table_id) return
    const hasLoaded = nocodbDataByCategory[category.id]
    const isLoading = nocodbLoadingByCategory[category.id]
    if (hasLoaded || isLoading) return
    loadNocodbRows(category.id, category.nocodb).catch(() => {})
  }, [selectedLocation?.id, activeInfoTab, selectedLocation?.updated_at])

  useEffect(() => {
    if (selectedLocation) {
      applyLocationToEditForm(selectedLocation)
      setActiveInfoTab(0)
    }
  }, [selectedLocationId])

  useEffect(() => {
    if (!currentUser) return
    loadAttachments(attachmentLocationId).catch(() => {})
  }, [attachmentLocationId, currentUser?.id])

  function handleMapClick(latlng) {
    if (!canEdit) return
    if (page !== 'new-point') return
    setLocationForm((prev) => ({
      ...prev,
      latitude: latlng.lat.toFixed(6),
      longitude: latlng.lng.toFixed(6),
    }))
    showStatus(`Coordinate selezionate: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`, 'info')
  }

  async function handleLogin(event) {
    event.preventDefault()
    setLoginLoading(true)
    setStatus(''); setStatusTone('info')
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Login fallito')
      }
      localStorage.setItem('geo_token', data.access_token)
      setCurrentUser(data.user)
      setToken(data.access_token)
      setStatus(''); setStatusTone('info')
    } catch (error) {
      showStatus(error.message, 'error')
    } finally {
      setLoginLoading(false)
    }
  }

  function updateCategory(setter, formState, index, key, value) {
    setter({
      ...formState,
      categories: formState.categories.map((item, currentIndex) =>
        currentIndex === index ? { ...item, [key]: value } : item,
      ),
    })
  }

  function updateCategoryTable(setter, formState, index, updater) {
    setter({
      ...formState,
      categories: formState.categories.map((item, currentIndex) =>
        currentIndex === index ? { ...item, table_data: updater(item.table_data || { columns: ['Campo'], rows: [{ Campo: '' }] }) } : item,
      ),
    })
  }

  function updateCategoryNocodb(setter, formState, index, updater) {
    setter({
      ...formState,
      categories: formState.categories.map((item, currentIndex) =>
        currentIndex === index ? { ...item, nocodb: typeof updater === 'function' ? updater(item.nocodb || { table_id: '', table_name: '', available_columns: [], visible_columns: [], filters: [] }) : { ...(item.nocodb || { table_id: '', table_name: '', available_columns: [], visible_columns: [], filters: [] }), ...updater } } : item,
      ),
    })
  }

  function appendCategoryFiles(setter, formState, index, bucket, files) {
    const incoming = Array.from(files || [])
    if (!incoming.length) return
    setter({
      ...formState,
      categories: formState.categories.map((item, currentIndex) =>
        currentIndex === index
          ? { ...item, [bucket]: [...(item[bucket] || []), ...incoming] }
          : item,
      ),
    })
  }

  function removePendingCategoryFile(setter, formState, index, bucket, fileIndex) {
    setter({
      ...formState,
      categories: formState.categories.map((item, currentIndex) =>
        currentIndex === index
          ? { ...item, [bucket]: (item[bucket] || []).filter((_, idx) => idx !== fileIndex) }
          : item,
      ),
    })
  }

  function toggleCategoryModule(setter, formState, index, moduleKey) {
    setter({
      ...formState,
      categories: formState.categories.map((item, currentIndex) => {
        if (currentIndex !== index) return item
        const activeModules = ensureCategoryModules(item)
        const enabled = activeModules.includes(moduleKey)
        const nextModules = enabled ? activeModules.filter((value) => value !== moduleKey) : [...activeModules, moduleKey]
        const nextItem = { ...item, modules: nextModules }
        if (enabled) {
          if (moduleKey === 'description') nextItem.content = ''
          if (moduleKey === 'images') nextItem.pending_image_files = []
          if (moduleKey === 'documents') nextItem.pending_document_files = []
          if (moduleKey === 'nocodb') nextItem.nocodb = { table_id: '', table_name: '', available_columns: [], visible_columns: [], filters: [] }
        } else if (moduleKey === 'nocodb' && !(item.nocodb?.filters || []).length) {
          nextItem.nocodb = { ...(item.nocodb || {}), filters: [{ field: '', op: 'eq', value: '' }] }
        }
        return nextItem
      }),
    })
  }

  function addCategory(setter, formState, setActiveTab) {
    if (!canEdit) return
    const title = window.prompt('Titolo del tab')
    if (!title || !title.trim()) return
    const nextCategories = [...formState.categories, makeEmptyCategory(title.trim())]
    setter({ ...formState, categories: nextCategories })
    setActiveTab(nextCategories.length - 1)
  }

  function removeCategory(setter, formState, setActiveTab, index) {
    if (!canEdit) return
    const nextCategories = formState.categories.filter((_, currentIndex) => currentIndex !== index)
    setter({ ...formState, categories: nextCategories })
    setActiveTab(Math.max(0, Math.min(index - 1, nextCategories.length - 1)))
  }

  function addTableColumn(setter, formState, index) {
    const label = window.prompt('Nome colonna')
    if (!label || !label.trim()) return
    updateCategoryTable(setter, formState, index, (table) => {
      const column = label.trim()
      const columns = [...(table.columns || []), column]
      const rows = (table.rows || []).map((row) => ({ ...row, [column]: '' }))
      return { columns, rows }
    })
  }

  function removeTableColumn(setter, formState, index, column) {
    updateCategoryTable(setter, formState, index, (table) => {
      const columns = (table.columns || []).filter((item) => item !== column)
      const rows = (table.rows || []).map((row) => {
        const next = { ...row }
        delete next[column]
        return next
      })
      return { columns: columns.length ? columns : ['Campo'], rows: rows.length ? rows : [{ [columns[0] || 'Campo']: '' }] }
    })
  }

  function addTableRow(setter, formState, index) {
    updateCategoryTable(setter, formState, index, (table) => {
      const columns = table.columns?.length ? table.columns : ['Campo']
      const nextRow = Object.fromEntries(columns.map((column) => [column, '']))
      return { columns, rows: [...(table.rows || []), nextRow] }
    })
  }

  function updateTableCell(setter, formState, index, rowIndex, column, value) {
    updateCategoryTable(setter, formState, index, (table) => ({
      columns: table.columns || [column],
      rows: (table.rows || []).map((row, currentRowIndex) => currentRowIndex === rowIndex ? { ...row, [column]: value } : row),
    }))
  }

  function removeTableRow(setter, formState, index, rowIndex) {
    updateCategoryTable(setter, formState, index, (table) => {
      const columns = table.columns?.length ? table.columns : ['Campo']
      const rows = (table.rows || []).filter((_, currentRowIndex) => currentRowIndex !== rowIndex)
      return { columns, rows: rows.length ? rows : [Object.fromEntries(columns.map((column) => [column, '']))] }
    })
  }

  function addNocodbFilter(setter, formState, index) {
    updateCategoryNocodb(setter, formState, index, (nocodb) => ({
      ...nocodb,
      filters: [...(nocodb.filters || []), { field: '', op: 'eq', value: '' }],
    }))
  }

  function updateNocodbFilter(setter, formState, index, filterIndex, key, value) {
    updateCategoryNocodb(setter, formState, index, (nocodb) => ({
      ...nocodb,
      filters: (nocodb.filters || []).map((filter, currentIndex) => currentIndex === filterIndex ? { ...filter, [key]: value } : filter),
    }))
  }

  function removeNocodbFilter(setter, formState, index, filterIndex) {
    updateCategoryNocodb(setter, formState, index, (nocodb) => ({
      ...nocodb,
      filters: (nocodb.filters || []).filter((_, currentIndex) => currentIndex !== filterIndex),
    }))
  }

  async function uploadFilesForCategory(locationId, categoryId, files) {
    for (const file of files || []) {
      const body = new FormData()
      body.append('location_id', String(locationId))
      body.append('category_id', String(categoryId))
      body.append('file', file)
      await api('/attachments', { method: 'POST', body })
    }
  }

  async function uploadCategoryAssets(locationId, returnedCategories, sourceCategories) {
    for (let index = 0; index < returnedCategories.length; index += 1) {
      const returnedCategory = returnedCategories[index]
      const sourceCategory = sourceCategories[index]
      if (!returnedCategory || !sourceCategory) continue
      await uploadFilesForCategory(locationId, returnedCategory.id, sourceCategory.pending_image_files)
      await uploadFilesForCategory(locationId, returnedCategory.id, sourceCategory.pending_document_files)
    }
  }

  async function createLocation(event) {
    event.preventDefault()
    try {
      const preparedCategories = locationForm.categories.filter((item) => item.title.trim())
      const created = await api('/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...locationForm,
          latitude: Number(locationForm.latitude),
          longitude: Number(locationForm.longitude),
          categories: sanitizeCategoriesForApi(preparedCategories),
        }),
      })
      if (locationImageFile) {
        await saveLocationImage(created.id, locationImageFile)
      }
      await uploadCategoryAssets(created.id, created.categories || [], preparedCategories)
      setLocationForm(initialLocationForm)
      setLocationImageFile(null)
      setActiveCreateTab(0)
      setSelectedLocationId(created.id)
      setHomeDetailsOpen(true)
      await refreshAll()
      setPage('home')
      showStatus('Punto creato correttamente.', 'success')
    } catch (error) {
      showStatus(error.message, 'error')
    }
  }

  async function saveLocationImage(locationId, file) {
    const imageBody = new FormData()
    imageBody.append('file', file)
    await api(`/locations/${locationId}/image`, { method: 'POST', body: imageBody })
  }

  async function updateLocationImage() {
    if (!selectedLocationId || !managementImageFile) return
    try {
      await saveLocationImage(selectedLocationId, managementImageFile)
      setManagementImageFile(null)
      await refreshAll()
      showStatus('Foto del punto aggiornata.', 'success')
    } catch (error) {
      showStatus(error.message, 'error')
    }
  }

  async function deleteLocationImage() {
    if (!selectedLocationId) return
    if (!window.confirm('Eliminare la foto del punto?')) return
    try {
      await api(`/locations/${selectedLocationId}/image`, { method: 'DELETE' })
      setManagementImageFile(null)
      await refreshAll()
      showStatus('Foto del punto eliminata.', 'success')
    } catch (error) {
      showStatus(error.message, 'error')
    }
  }

  async function updateLocation(event) {
    event.preventDefault()
    if (!selectedLocationId) return
    try {
      const preparedCategories = managementForm.categories.filter((item) => item.title.trim())
      const updated = await api(`/locations/${selectedLocationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...managementForm,
          latitude: Number(managementForm.latitude),
          longitude: Number(managementForm.longitude),
          categories: sanitizeCategoriesForApi(preparedCategories),
        }),
      })
      await uploadCategoryAssets(selectedLocationId, updated.categories || [], preparedCategories)
      setNocodbDataByCategory({})
      setNocodbErrorByCategory({})
      await refreshAll()
      setHomeDetailsOpen(true)
      setPage('home')
      showStatus('Punto aggiornato.', 'success')
    } catch (error) {
      showStatus(error.message, 'error')
    }
  }

  async function deleteLocation(locationId) {
    if (!window.confirm('Vuoi davvero eliminare questo punto?')) return
    try {
      await api(`/locations/${locationId}`, { method: 'DELETE' })
      await refreshAll()
      showStatus('Punto eliminato.', 'success')
    } catch (error) {
      showStatus(error.message, 'error')
    }
  }

  async function saveUser(event) {
    event.preventDefault()
    const path = editingUserId ? `/users/${editingUserId}` : '/users'
    const method = editingUserId ? 'PUT' : 'POST'
    const payload = { ...userForm }
    if (editingUserId && !payload.password.trim()) {
      delete payload.password
    }
    try {
      await api(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setUserForm(initialUserForm)
      setEditingUserId(null)
      await Promise.all([loadUsers(), loadStats()])
      showStatus(editingUserId ? 'Utente aggiornato.' : 'Utente creato.', 'success')
    } catch (error) {
      showStatus(error.message, 'error')
    }
  }

  function startEditUser(user) {
    setEditingUserId(user.id)
    setUserForm({
      username: user.username,
      email: user.email,
      password: '',
      role: user.role,
      is_active: user.is_active,
    })
  }

  async function deleteUser(userId) {
    if (!window.confirm('Eliminare questo utente?')) return
    try {
      await api(`/users/${userId}`, { method: 'DELETE' })
      if (editingUserId === userId) {
        setEditingUserId(null)
        setUserForm(initialUserForm)
      }
      await Promise.all([loadUsers(), loadStats()])
      showStatus('Utente eliminato.', 'success')
    } catch (error) {
      showStatus(error.message, 'error')
    }
  }

  async function uploadAttachment(event) {
    event.preventDefault()
    if (!attachmentLocationId || !attachmentFile) {
      showStatus('Seleziona un punto e un file da caricare.', 'error')
      return
    }
    const body = new FormData()
    body.append('location_id', attachmentLocationId)
    if (attachmentCategoryId) {
      body.append('category_id', attachmentCategoryId)
    }
    body.append('file', attachmentFile)

    try {
      await api('/attachments', { method: 'POST', body })
      setAttachmentFile(null)
      setAttachmentCategoryId('')
      const input = document.getElementById('attachment-input')
      if (input) input.value = ''
      await Promise.all([loadAttachments(attachmentLocationId), loadLocations(), loadStats()])
      showStatus('Allegato caricato.', 'success')
    } catch (error) {
      showStatus(error.message, 'error')
    }
  }

  async function deleteAttachment(attachmentId) {
    if (!window.confirm('Eliminare questo allegato?')) return
    try {
      await api(`/attachments/${attachmentId}`, { method: 'DELETE' })
      await Promise.all([loadAttachments(attachmentLocationId), loadLocations(), loadStats()])
      showStatus('Allegato eliminato.', 'success')
    } catch (error) {
      showStatus(error.message, 'error')
    }
  }

  function downloadExport() {
    window.open(`${API_BASE_URL}/export/json?token=${encodeURIComponent(token)}`, '_blank')
  }

  async function importJson(event) {
    const file = event.target.files?.[0]
    if (!file) return
    const body = new FormData()
    body.append('file', file)
    try {
      await api('/import/json', { method: 'POST', body })
      await refreshAll()
      showStatus('Import completato.', 'success')
    } catch (error) {
      showStatus(error.message, 'error')
    } finally {
      event.target.value = ''
    }
  }

  const filteredLocations = locations.filter((location) => {
    const q = searchQuery.trim().toLowerCase()
    return !q ||
      location.name?.toLowerCase().includes(q) ||
      location.description?.toLowerCase().includes(q) ||
      location.categories?.some((item) => item.title.toLowerCase().includes(q) || item.content.toLowerCase().includes(q))
  })

  function renderTabs(formState, setter, activeTab, setActiveTab, editable = true) {
    const activeCategory = formState.categories[activeTab]
    const selectedNocoTable = nocodbTables.find((item) => item.id === activeCategory?.nocodb?.table_id)
    const activeModules = ensureCategoryModules(activeCategory || {})
    return (
      <div className="tab-editor">
        <div className="tab-chip-row">
          {formState.categories.map((category, index) => (
            <button
              type="button"
              key={`${category.title}-${index}`}
              className={`tab-chip ${activeTab === index ? 'active' : ''}`}
              onClick={() => setActiveTab(index)}
            >
              {category.title}
            </button>
          ))}
          {editable ? (
            <button type="button" className="icon-plus" onClick={() => addCategory(setter, formState, setActiveTab)}>
              +
            </button>
          ) : null}
        </div>
        {activeCategory ? (
          <div className="sub-card tab-content read-only-tab">
            <label>
              Nome tab
              <input
                value={activeCategory.title}
                onChange={(event) => updateCategory(setter, formState, activeTab, 'title', event.target.value)}
                disabled={!editable}
              />
            </label>

            <div className="sub-card nested-card">
              <div className="section-row slim-row wrap-row">
                <strong>Contenuti del tab</strong>
                <span className="muted compact-text">Scegli uno o più blocchi da mostrare in questo tab.</span>
              </div>
              <div className="module-chip-row">
                {categoryModuleOptions.map((option) => {
                  const selected = activeModules.includes(option.value)
                  return (
                    <button
                      type="button"
                      key={option.value}
                      className={`module-chip ${selected ? 'active' : ''}`}
                      onClick={() => toggleCategoryModule(setter, formState, activeTab, option.value)}
                      disabled={!editable}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {activeModules.includes('description') ? (
              <label>
                Descrizione del tab
                <textarea
                  rows="5"
                  value={activeCategory.content}
                  onChange={(event) => updateCategory(setter, formState, activeTab, 'content', event.target.value)}
                  disabled={!editable}
                />
              </label>
            ) : null}

            {activeModules.includes('images') || activeModules.includes('documents') ? (
              <div className="media-split-grid">
                {activeModules.includes('images') ? (
                  <div className="sub-card">
                    <div className="section-row slim-row"><strong>Immagini del tab</strong><span className="muted compact-text">Slider automatico in lettura</span></div>
                    <label className="inline-file-label">
                      <span>Aggiungi immagini</span>
                      <input type="file" accept="image/*" multiple onChange={(event) => appendCategoryFiles(setter, formState, activeTab, 'pending_image_files', event.target.files)} disabled={!editable} />
                    </label>
                    <div className="clean-list compact-text">
                      {(activeCategory.pending_image_files || []).map((file, fileIndex) => (
                        <div key={`${file.name}-${fileIndex}`} className="section-row slim-row sub-card compact-row">
                          <span>{file.name}</span>
                          {editable ? <button type="button" className="danger" onClick={() => removePendingCategoryFile(setter, formState, activeTab, 'pending_image_files', fileIndex)}>Rimuovi</button> : null}
                        </div>
                      ))}
                      {!activeCategory.pending_image_files?.length ? <span className="muted">Nessuna nuova immagine selezionata.</span> : null}
                    </div>
                  </div>
                ) : null}

                {activeModules.includes('documents') ? (
                  <div className="sub-card">
                    <div className="section-row slim-row"><strong>Documenti del tab</strong><span className="muted compact-text">PDF, testo e altri file</span></div>
                    <label className="inline-file-label">
                      <span>Aggiungi documenti</span>
                      <input type="file" multiple onChange={(event) => appendCategoryFiles(setter, formState, activeTab, 'pending_document_files', event.target.files)} disabled={!editable} />
                    </label>
                    <div className="clean-list compact-text">
                      {(activeCategory.pending_document_files || []).map((file, fileIndex) => (
                        <div key={`${file.name}-${fileIndex}`} className="section-row slim-row sub-card compact-row">
                          <span>{file.name}</span>
                          {editable ? <button type="button" className="danger" onClick={() => removePendingCategoryFile(setter, formState, activeTab, 'pending_document_files', fileIndex)}>Rimuovi</button> : null}
                        </div>
                      ))}
                      {!activeCategory.pending_document_files?.length ? <span className="muted">Nessun nuovo documento selezionato.</span> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeModules.includes('nocodb') ? (
              <div className="sub-card">
                <div className="section-row slim-row wrap-row">
                  <strong>Tabella NocoDB</strong>
                  <button type="button" className="ghost-button" onClick={loadNocodbTables} disabled={!editable}>Aggiorna elenco</button>
                </div>
                <div className="grid-two nocodb-config-grid">
                  <label>
                    Tabella
                    <details className="multi-select-dropdown nocodb-table-dropdown">
                      <summary>
                        <div className="multi-select-summary-content">
                          <div className="multi-select-summary-copy">
                            <strong>{activeCategory.nocodb?.table_name || 'Seleziona tabella NocoDB'}</strong>
                            <span className="muted compact-text">
                              {activeCategory.nocodb?.table_name
                                ? 'Tabella sorgente collegata a questo tab'
                                : 'Scegli la tabella sorgente da collegare a questo tab'}
                            </span>
                          </div>
                          <div className="multi-select-summary-meta">
                            <span className="selection-count-pill">{nocodbTables.length || 0}</span>
                            <span className="dropdown-caret">⌄</span>
                          </div>
                        </div>
                      </summary>
                      <div className="multi-select-panel">
                        <div className="multi-select-panel-head">
                          <span className="panel-section-label">Tabelle disponibili</span>
                          <span className="panel-section-meta">{nocodbTables.length || 0} tabelle</span>
                        </div>
                        {activeCategory.nocodb?.table_name ? (
                          <div className="selected-columns-surface">
                            <div className="selected-columns-label">Attiva in questo tab</div>
                            <div className="selected-columns-preview">
                              <span className="selected-column-chip">{activeCategory.nocodb.table_name}</span>
                            </div>
                          </div>
                        ) : null}
                        <div className="checkbox-grid table-choice-grid">
                          {nocodbTables.map((item) => {
                            const checked = activeCategory.nocodb?.table_id === item.id
                            return (
                              <button
                                key={item.id}
                                type="button"
                                className={`column-choice-card table-choice-card ${checked ? 'checked' : ''}`}
                                disabled={!editable}
                                onClick={async () => {
                                  const tableId = item.id
                                  const selectedTable = nocodbTables.find((entry) => entry.id === tableId)
                                  const columns = tableId ? await loadNocodbColumns(tableId) : []
                                  updateCategoryNocodb(setter, formState, activeTab, {
                                    table_id: tableId,
                                    table_name: selectedTable?.title || '',
                                    available_columns: columns,
                                    visible_columns: (activeCategory.nocodb?.visible_columns || []).filter((entry) => columns.includes(entry)),
                                    filters: (activeCategory.nocodb?.filters || []).map((filter) => ({ ...filter, field: columns.includes(filter.field) ? filter.field : '' })),
                                  })
                                }}
                              >
                                <span className={`column-choice-check ${checked ? 'checked' : ''}`} aria-hidden="true" />
                                <span className="column-choice-text">
                                  <strong>{item.title}</strong>
                                  <span className="column-choice-subtitle">Origine dati NocoDB</span>
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    </details>
                  </label>
                  <label>
                    Colonne visibili
                    <details className="multi-select-dropdown nocodb-columns-dropdown">
                      <summary>
                        <div className="multi-select-summary-content">
                          <div className="multi-select-summary-copy">
                            <strong>{(activeCategory.nocodb?.visible_columns || []).length ? `${(activeCategory.nocodb?.visible_columns || []).length} selezionate` : 'Seleziona colonne'}</strong>
                            <span className="muted compact-text">
                              {(activeCategory.nocodb?.visible_columns || []).length
                                ? activeCategory.nocodb.visible_columns.slice(0, 3).join(' • ')
                                : 'Scegli i campi da mostrare nella vista'}
                            </span>
                          </div>
                          <div className="multi-select-summary-meta">
                            <span className="selection-count-pill">{(activeCategory.nocodb?.visible_columns || []).length}/{(activeCategory.nocodb?.available_columns || nocodbColumnsByTable[activeCategory.nocodb?.table_id] || []).length || 0}</span>
                            <span className="dropdown-caret">⌄</span>
                          </div>
                        </div>
                      </summary>
                      <div className="multi-select-panel">
                        <div className="multi-select-panel-head">
                          <span className="panel-section-label">Colonne disponibili</span>
                          <span className="panel-section-meta">{((activeCategory.nocodb?.available_columns || nocodbColumnsByTable[activeCategory.nocodb?.table_id] || []).length) || 0} campi</span>
                        </div>
                        {(activeCategory.nocodb?.visible_columns || []).length ? (
                          <div className="selected-columns-surface">
                            <div className="selected-columns-label">Attive nella tabella</div>
                            <div className="selected-columns-preview">
                              {(activeCategory.nocodb?.visible_columns || []).map((column) => (
                                <span key={`selected-${column}`} className="selected-column-chip">{column}</span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        <div className="checkbox-grid clean-checkbox-grid">
                          {((activeCategory.nocodb?.available_columns || nocodbColumnsByTable[activeCategory.nocodb?.table_id] || []).map((column) => {
                            const checked = (activeCategory.nocodb?.visible_columns || []).includes(column)
                            return (
                              <label key={column} className={`column-choice-card ${checked ? 'checked' : ''} ${!editable ? 'disabled' : ''}`}>
                                <input
                                  className="column-choice-input"
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => updateCategoryNocodb(setter, formState, activeTab, {
                                    visible_columns: checked
                                      ? (activeCategory.nocodb?.visible_columns || []).filter((item) => item !== column)
                                      : [...(activeCategory.nocodb?.visible_columns || []), column],
                                  })}
                                  disabled={!editable}
                                />
                                <span className="column-choice-mark" aria-hidden="true">
                                  <span className="column-choice-mark-inner">{checked ? '✓' : ''}</span>
                                </span>
                                <span className="column-choice-copy">
                                  <span className="column-choice-title">{column}</span>
                                  <span className="column-choice-subtitle">Visibile nella tabella NocoDB</span>
                                </span>
                              </label>
                            )
                          }))}
                        </div>
                        {!(activeCategory.nocodb?.table_id) ? <span className="muted compact-text">Seleziona prima una tabella.</span> : !((activeCategory.nocodb?.available_columns || nocodbColumnsByTable[activeCategory.nocodb?.table_id] || []).length) ? <span className="muted compact-text">Nessuna colonna disponibile.</span> : null}
                      </div>
                    </details>
                  </label>
                </div>
                <div className="section-row slim-row wrap-row filter-section-header">
                  <strong>Filtri</strong>
                  {editable ? <button type="button" className="ghost-button" onClick={() => addNocodbFilter(setter, formState, activeTab)} disabled={!activeCategory.nocodb?.table_id}>Aggiungi filtro</button> : null}
                </div>
                <div className="clean-list nocodb-filters-list">
                  {(activeCategory.nocodb?.filters || []).map((filter, filterIndex) => (
                    <div key={`filter-${filterIndex}`} className="grid-three compact-grid-row">
                      <select value={filter.field || ''} onChange={(event) => updateNocodbFilter(setter, formState, activeTab, filterIndex, 'field', event.target.value)} disabled={!editable}>
                        <option value="">Campo filtro</option>
                        {(activeCategory.nocodb?.available_columns || nocodbColumnsByTable[activeCategory.nocodb?.table_id] || []).map((column) => <option key={column} value={column}>{column}</option>)}
                      </select>
                      <select value={filter.op || 'eq'} onChange={(event) => updateNocodbFilter(setter, formState, activeTab, filterIndex, 'op', event.target.value)} disabled={!editable}>
                        <option value="eq">eq</option>
                        <option value="neq">neq</option>
                        <option value="like">like</option>
                        <option value="nlike">nlike</option>
                        <option value="gt">gt</option>
                        <option value="ge">ge</option>
                        <option value="lt">lt</option>
                        <option value="le">le</option>
                        <option value="is">is</option>
                        <option value="isnot">isnot</option>
                        <option value="in">in</option>
                      </select>
                      <div className="section-row slim-row">
                        <input placeholder="Valore" value={filter.value || ''} onChange={(event) => updateNocodbFilter(setter, formState, activeTab, filterIndex, 'value', event.target.value)} disabled={!editable} />
                        {editable ? <button type="button" className="danger small-button" onClick={() => removeNocodbFilter(setter, formState, activeTab, filterIndex)}>Rimuovi</button> : null}
                      </div>
                    </div>
                  ))}
                  {!activeCategory.nocodb?.filters?.length ? <span className="muted compact-text">Nessun filtro configurato.</span> : null}
                </div>
                {selectedNocoTable ? <p className="muted compact-text">Tabella selezionata: {selectedNocoTable.title}</p> : null}
              </div>
            ) : null}

            {editable ? <button type="button" className="danger" onClick={() => removeCategory(setter, formState, activeTab, setActiveTab)}>Rimuovi tab</button> : null}
          </div>
        ) : null}
      </div>
    )
  }

  function renderReadOnlyTabs(location) {
    const categories = location?.categories || []
    if (!categories.length) {
      return <p className="muted compact-text">Nessun tab informativo associato a questo punto.</p>
    }

    const safeIndex = Math.min(activeInfoTab, categories.length - 1)
    const activeCategory = categories[safeIndex]
    const categoryAttachments = (location.attachments || []).filter((attachment) => attachment.category_id === activeCategory?.id)
    const imageAttachments = categoryAttachments.filter(isImageAttachment)
    const documentAttachments = categoryAttachments.filter(isDocumentAttachment)
    const imageIndex = Math.min(activeImageIndexByCategory[activeCategory?.id] || 0, Math.max(imageAttachments.length - 1, 0))
    const documentIndex = Math.min(activeDocumentIndexByCategory[activeCategory?.id] || 0, Math.max(documentAttachments.length - 1, 0))
    const activeImage = imageAttachments[imageIndex]
    const activeDocument = documentAttachments[documentIndex]
    const nocoState = nocodbDataByCategory[activeCategory?.id]
    const nocoLoading = nocodbLoadingByCategory[activeCategory?.id]
    const nocoError = nocodbErrorByCategory[activeCategory?.id]
    const activeModules = ensureCategoryModules(activeCategory, categoryAttachments)

    return (
      <div className="tab-editor">
        <div className="tab-chip-row">
          {categories.map((category, index) => (
            <button
              type="button"
              key={`${category.title}-${index}`}
              className={`tab-chip ${safeIndex === index ? 'active' : ''}`}
              onClick={() => setActiveInfoTab(index)}
            >
              {category.title}
            </button>
          ))}
        </div>
        {activeCategory ? (
          <div className="sub-card tab-content read-only-tab">
            <h3>{activeCategory.title}</h3>

            {activeModules.includes('description') ? (
              <div className="sub-card nested-card">
                <div className="section-row slim-row"><strong>Descrizione</strong></div>
                <p className="compact-text preserve-lines">{activeCategory.content || 'Nessun contenuto inserito.'}</p>
              </div>
            ) : null}

            {activeModules.includes('images') && imageAttachments.length ? (
              <div className="sub-card nested-card">
                <div className="section-row slim-row wrap-row">
                  <strong>Foto</strong>
                  <div className="section-row slim-row">
                    <button type="button" className="ghost-button" onClick={() => setActiveImageIndexByCategory((prev) => ({ ...prev, [activeCategory.id]: Math.max(0, imageIndex - 1) }))} disabled={imageIndex === 0}>◀</button>
                    <span className="muted compact-text">{imageIndex + 1} / {imageAttachments.length}</span>
                    <button type="button" className="ghost-button" onClick={() => setActiveImageIndexByCategory((prev) => ({ ...prev, [activeCategory.id]: Math.min(imageAttachments.length - 1, imageIndex + 1) }))} disabled={imageIndex >= imageAttachments.length - 1}>▶</button>
                  </div>
                </div>
                {activeImage ? <img className="slider-image" src={`${API_BASE_URL}${activeImage.download_url}?token=${encodeURIComponent(token)}`} alt={activeImage.original_name} /> : null}
              </div>
            ) : null}

            {activeModules.includes('documents') && documentAttachments.length ? (
              <div className="sub-card nested-card">
                <div className="section-row slim-row wrap-row">
                  <strong>Documenti</strong>
                  <div className="section-row slim-row">
                    <button type="button" className="ghost-button" onClick={() => setActiveDocumentIndexByCategory((prev) => ({ ...prev, [activeCategory.id]: Math.max(0, documentIndex - 1) }))} disabled={documentIndex === 0}>◀</button>
                    <span className="muted compact-text">{documentIndex + 1} / {documentAttachments.length}</span>
                    <button type="button" className="ghost-button" onClick={() => setActiveDocumentIndexByCategory((prev) => ({ ...prev, [activeCategory.id]: Math.min(documentAttachments.length - 1, documentIndex + 1) }))} disabled={documentIndex >= documentAttachments.length - 1}>▶</button>
                  </div>
                </div>
                {activeDocument ? (
                  <div className="document-viewer-wrap">
                    {isPdfAttachment(activeDocument) ? (
                      <iframe title={activeDocument.original_name} className="document-viewer" src={`${API_BASE_URL}${activeDocument.download_url}?token=${encodeURIComponent(token)}`} />
                    ) : (
                      <a className="linkish" href={`${API_BASE_URL}${activeDocument.download_url}?token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">Apri {activeDocument.original_name}</a>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeModules.includes('nocodb') && activeCategory.nocodb?.table_id ? (
              <div className="sub-card nested-card">
                <div className="section-row slim-row wrap-row nocodb-readonly-header">
                  <strong>NocoDB · {activeCategory.nocodb.table_name || activeCategory.nocodb.table_id}</strong>
                  <button type="button" className="ghost-button" onClick={() => loadNocodbRows(activeCategory.id, activeCategory.nocodb)}>Aggiorna dati</button>
                </div>
                {(activeCategory.nocodb.filters || []).length ? (
                  <div className="clean-list nocodb-readonly-filters-list">
                    {activeCategory.nocodb.filters.map((filter, filterIndex) => (
                      <div key={`readonly-filter-${filterIndex}`} className="grid-three compact-grid-row">
                        <input value={filter.field || ''} disabled />
                        <input value={filter.op || 'eq'} disabled />
                        <input
                          value={filter.value || ''}
                          onChange={(event) => {
                            const nextCategories = [...categories]
                            nextCategories[safeIndex] = {
                              ...activeCategory,
                              nocodb: {
                                ...activeCategory.nocodb,
                                filters: activeCategory.nocodb.filters.map((item, currentIndex) => currentIndex === filterIndex ? { ...item, value: event.target.value } : item),
                              },
                            }
                            setLocations((prev) => prev.map((entry) => entry.id === location.id ? { ...entry, categories: nextCategories } : entry))
                            setNocodbDataByCategory((prev) => ({ ...prev, [activeCategory.id]: null }))
                          }}
                        />
                      </div>
                    ))}
                  </div>
                ) : <p className="muted compact-text">Nessun filtro configurato: vengono mostrati i record della tabella selezionata.</p>}
                {nocoLoading ? <p className="muted compact-text">Caricamento dati NocoDB...</p> : null}
                {nocoError ? <p className="muted compact-text">{nocoError}</p> : null}
                {nocoState?.rows?.length ? (
                  <div className="table-builder-wrap nocodb-results-table-wrap">
                    <table className="data-table read-only-table">
                      <thead>
                        <tr>{(nocoState.columns || []).map((column) => <th key={column}>{column}</th>)}</tr>
                      </thead>
                      <tbody>
                        {nocoState.rows.map((row, rowIndex) => (
                          <tr key={`noco-row-${rowIndex}`}>{(nocoState.columns || []).map((column) => <td key={`${rowIndex}-${column}`}>{String(row[column] ?? '')}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (!nocoLoading && !nocoError ? <p className="muted compact-text">Nessun record restituito dai filtri impostati.</p> : null)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  function renderMap() {
    return (
      <MapContainer center={mapCenter} zoom={2} scrollWheelZoom className="leaflet-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler onMapClick={handleMapClick} />
        {locations.map((location) => (
          <Marker
            key={location.id}
            position={[location.latitude, location.longitude]}
            icon={createMarkerIcon(location.marker_color, location.marker_icon)}
            eventHandlers={{ click: () => { setSelectedLocationId(location.id); setHomeDetailsOpen(true) } }}
          >
          </Marker>
        ))}
      </MapContainer>
    )
  }

  function renderHome() {
    return (
      <div className="full-map-layout home-clean-layout">
        <section className="panel map-stage">
          <div className="map-stage-header">
            <div>
              <h1>Mappa globale</h1>
              <p className="muted compact-text">Clicca un marker per aprire il pannello con i dettagli del punto sotto la mappa.</p>
            </div>
          </div>
          <div className="map-frame map-frame-fullscreen home-map-frame">
            {renderMap()}
          </div>
        </section>

        {homeDetailsOpen && selectedLocation ? (
          <section className="panel info-dock">
            <div className="section-card-header">
              <div>
                <h2>{selectedLocation.name}</h2>
                <p className="muted compact-text">{selectedLocation.description || 'Nessuna descrizione disponibile.'}</p>
              </div>
              <div className="info-dock-badges">
                <span className="tiny-dot" style={{ background: selectedLocation.marker_color }}>{selectedLocation.marker_icon}</span>
              </div>
            </div>

            {selectedLocation.image_url ? (
              <div className="location-hero-image-wrap">
                <img
                  className="location-hero-image"
                  src={`${API_BASE_URL}${selectedLocation.image_url}?token=${encodeURIComponent(token)}`}
                  alt={selectedLocation.image_original_name || selectedLocation.name}
                />
              </div>
            ) : null}

            <div className="details-grid compact-text clean-details-grid">
              <div className="sub-card"><strong>Latitudine</strong><div>{selectedLocation.latitude}</div></div>
              <div className="sub-card"><strong>Longitudine</strong><div>{selectedLocation.longitude}</div></div>
              <div className="sub-card"><strong>Colore</strong><div className="color-swatch-row"><span className="color-swatch-large" style={{ background: selectedLocation.marker_color }}></span><span className="muted compact-text">Marker selezionato</span></div></div>
              <div className="sub-card"><strong>Icona</strong><div>{selectedLocation.marker_icon}</div></div>
            </div>
            {renderReadOnlyTabs(selectedLocation)}
          </section>
        ) : null}
      </div>
    )
  }

  function renderNewPoint() {
    return (
      <div className="stack-layout new-point-stack new-point-screen">
        <section className="panel map-panel">
          <div className="section-card-header">
            <div>
              <h1>Nuovo punto</h1>
              <p className="muted compact-text">Clicca la mappa per compilare latitudine e longitudine in automatico.</p>
            </div>
            <div className="mini-badge">+</div>
          </div>
          <div className="map-frame large-map new-point-map">
            {renderMap()}
          </div>
        </section>

        <SectionCard
          title="Dati del punto"
          subtitle={canEdit ? 'Compila il form e aggiungi i tab solo quando ti servono.' : 'Solo admin ed editor possono creare punti.'}
        >
          <form onSubmit={createLocation} className="new-point-form">
            <div className="new-point-fields-stack">
              <label>
                Nome
                <input value={locationForm.name} onChange={(e) => setLocationForm({ ...locationForm, name: e.target.value })} required disabled={!canEdit} />
              </label>
              <label>
                Descrizione
                <textarea rows="3" value={locationForm.description} onChange={(e) => setLocationForm({ ...locationForm, description: e.target.value })} disabled={!canEdit} />
              </label>
            </div>
            <div className="grid-two">
              <label>
                Latitudine
                <input type="number" step="0.000001" value={locationForm.latitude} onChange={(e) => setLocationForm({ ...locationForm, latitude: e.target.value })} required disabled={!canEdit} />
              </label>
              <label>
                Longitudine
                <input type="number" step="0.000001" value={locationForm.longitude} onChange={(e) => setLocationForm({ ...locationForm, longitude: e.target.value })} required disabled={!canEdit} />
              </label>
            </div>
            <MarkerStyleRow
              color={locationForm.marker_color}
              icon={locationForm.marker_icon}
              onColorChange={(value) => setLocationForm({ ...locationForm, marker_color: value })}
              onIconChange={(value) => setLocationForm({ ...locationForm, marker_icon: value })}
              disabled={!canEdit}
            />

            <label>
              Foto del punto
              <input type="file" accept="image/*" onChange={(e) => setLocationImageFile(e.target.files?.[0] || null)} disabled={!canEdit} />
            </label>
            {locationImageFile ? <p className="muted compact-text">Immagine selezionata: {locationImageFile.name}</p> : null}

            {renderTabs(locationForm, setLocationForm, activeCreateTab, setActiveCreateTab, canEdit)}

            {canEdit ? <button type="submit" className="full-width new-point-submit">Crea punto</button> : null}
          </form>
        </SectionCard>
      </div>
    )
  }

  function renderPoints() {
    return (
      <div className="management-grid two-columns">
        <SectionCard title="Punti salvati" subtitle="Seleziona un punto per modificarne dati, tab e marker.">
          <div className="locations-list">
            {locations.map((location) => (
              <button
                key={location.id}
                type="button"
                className={`result-card ${selectedLocationId === location.id ? 'active-card' : ''}`}
                onClick={() => setSelectedLocationId(location.id)}
              >
                <div className="result-card-top">
                  <strong>{location.name}</strong>
                  <span className="tiny-dot" style={{ background: location.marker_color }}>{location.marker_icon}</span>
                </div>
                <div className="location-row"><span>{location.latitude}, {location.longitude}</span></div>
                <div className="muted compact-text">Apri per vedere e modificare i dettagli del punto</div>
              </button>
            ))}
            {locations.length === 0 ? <p className="muted compact-text">Nessun punto creato.</p> : null}
          </div>
        </SectionCard>

        {selectedLocation ? (
          <SectionCard
            title={`Modifica · ${selectedLocation.name}`}
            subtitle={canEdit ? 'Aggiorna campi, tab e aspetto del puntatore.' : 'Con il ruolo viewer puoi consultare i dati ma non modificarli.'}
            aside={canEdit ? <button type="button" className="danger" onClick={() => deleteLocation(selectedLocation.id)}>Elimina</button> : null}
          >
            <form onSubmit={updateLocation}>
              <label>
                Nome
                <input value={managementForm.name} onChange={(e) => setManagementForm({ ...managementForm, name: e.target.value })} required disabled={!canEdit} />
              </label>
              <label>
                Descrizione
                <textarea rows="3" value={managementForm.description} onChange={(e) => setManagementForm({ ...managementForm, description: e.target.value })} disabled={!canEdit} />
              </label>
              <div className="grid-two">
                <label>
                  Latitudine
                  <input type="number" step="0.000001" value={managementForm.latitude} onChange={(e) => setManagementForm({ ...managementForm, latitude: e.target.value })} required disabled={!canEdit} />
                </label>
                <label>
                  Longitudine
                  <input type="number" step="0.000001" value={managementForm.longitude} onChange={(e) => setManagementForm({ ...managementForm, longitude: e.target.value })} required disabled={!canEdit} />
                </label>
              </div>
              <MarkerStyleRow
                color={managementForm.marker_color}
                icon={managementForm.marker_icon}
                onColorChange={(value) => setManagementForm({ ...managementForm, marker_color: value })}
                onIconChange={(value) => setManagementForm({ ...managementForm, marker_icon: value })}
                disabled={!canEdit}
              />

              <div className="sub-card image-editor-card">
                <strong>Foto del punto</strong>
                {selectedLocation.image_url ? (
                  <div className="location-hero-image-wrap image-editor-preview">
                    <img
                      className="location-hero-image"
                      src={`${API_BASE_URL}${selectedLocation.image_url}?token=${encodeURIComponent(token)}`}
                      alt={selectedLocation.image_original_name || selectedLocation.name}
                    />
                  </div>
                ) : (
                  <div className="image-placeholder muted compact-text">Nessuna foto caricata</div>
                )}
                <div className="section-row wrap-row slim-row image-editor-actions">
                  <label className="inline-file-label">
                    <span>{managementImageFile ? managementImageFile.name : 'Seleziona immagine'}</span>
                    <input type="file" accept="image/*" onChange={(e) => setManagementImageFile(e.target.files?.[0] || null)} disabled={!canEdit} />
                  </label>
                  {canEdit ? <button type="button" className="ghost-button" onClick={updateLocationImage} disabled={!managementImageFile}>Carica / sostituisci</button> : null}
                  {canEdit && selectedLocation.image_url ? <button type="button" className="danger" onClick={deleteLocationImage}>Rimuovi foto</button> : null}
                </div>
              </div>

              {renderTabs(managementForm, setManagementForm, activeEditTab, setActiveEditTab, canEdit)}
              {canEdit ? <button type="submit" className="full-width">Salva modifiche</button> : null}
            </form>
          </SectionCard>
        ) : (
          <EmptyState title="Nessun punto selezionato" text="Crea o seleziona un punto per modificarlo." />
        )}
      </div>
    )
  }

  function renderSearch() {
    return (
      <div className="stack-layout search-layout-full">
        <SectionCard title="Ricerca punti" subtitle="Trova punti per nome, descrizione o contenuti dei tab.">
          <div className="search-toolbar">
            <label className="search-input-block">
              Cerca testo
              <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Es. infrastruttura, Roma, supply" />
            </label>
            <button type="button" className="ghost-button" onClick={() => setSearchQuery('')}>Reset ricerca</button>
          </div>
        </SectionCard>

        <SectionCard title="Risultati" subtitle={`${filteredLocations.length} ${filteredLocations.length === 1 ? 'risultato trovato' : 'risultati trovati'}`}>
          <div className="results-grid search-results-grid">
            {filteredLocations.map((location) => (
              <div className="panel sub-card search-result-card" key={location.id}>
                <div className="result-card-top">
                  <strong>{location.name}</strong>
                  <span className="tiny-dot" style={{ background: location.marker_color }}>{location.marker_icon}</span>
                </div>
                <p className="muted compact-text">{location.description || 'Nessuna descrizione'}</p>
                <div className="clean-list compact-text">
                  <div>Coordinate: {location.latitude}, {location.longitude}</div>
                  <div>Tab: {location.categories.length}</div>
                  <div>Allegati: {location.attachments?.length || 0}</div>
                </div>
                <button type="button" className="full-width" onClick={() => { setSelectedLocationId(location.id); setPage('points') }}>Apri in gestione</button>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    )
  }

  function renderSettings() {
    const locationOptions = locations
    const categoryOptions = (locations.find((item) => String(item.id) === attachmentLocationId)?.categories || [])

    return (
      <div className="stack-layout">
        <div className="management-grid settings-grid">
          <SectionCard title="Allegati" subtitle={canEdit ? 'Carica file per punto e tab.' : 'Con il ruolo viewer puoi solo consultare gli allegati.'}>
            <form onSubmit={uploadAttachment}>
              <label>
                Punto
                <select value={attachmentLocationId} onChange={(event) => { setAttachmentLocationId(event.target.value); setAttachmentCategoryId('') }}>
                  <option value="">Seleziona</option>
                  {locationOptions.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </label>
              <label>
                Tab collegato
                <select value={attachmentCategoryId} onChange={(event) => setAttachmentCategoryId(event.target.value)} disabled={!canEdit}>
                  <option value="">Nessuno</option>
                  {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.title}</option>)}
                </select>
              </label>
              <label>
                File
                <input id="attachment-input" type="file" onChange={(event) => setAttachmentFile(event.target.files?.[0] || null)} disabled={!canEdit} />
              </label>
              {canEdit ? <button type="submit" className="full-width">Carica allegato</button> : null}
            </form>
            <div className="locations-list attachments-compact-list">
              {attachments.slice(0, 8).map((attachment) => (
                <div className="sub-card compact-text" key={attachment.id}>
                  <strong>{attachment.original_name}</strong>
                  <div className="muted">Punto {attachment.location_id} · {Math.round(attachment.size_bytes / 1024)} KB</div>
                  <div className="section-row slim-row">
                    <a className="linkish" href={`${API_BASE_URL}${attachment.download_url}?token=${encodeURIComponent(token)}`} target="_blank" rel="noreferrer">Scarica</a>
                    {canEdit ? <button type="button" className="danger" onClick={() => deleteAttachment(attachment.id)}>Elimina</button> : null}
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Utenti e permessi" subtitle={isAdmin ? 'Gestione completa account e ruoli.' : 'Visibile solo in lettura per il tuo ruolo.'}>
            {isAdmin ? (
              <form onSubmit={saveUser}>
                <label>
                  Username
                  <input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} required />
                </label>
                <label>
                  Email
                  <input value={userForm.email} onChange={(event) => setUserForm({ ...userForm, email: event.target.value })} required />
                </label>
                <label>
                  Password {editingUserId ? '(lascia vuoto per non cambiarla)' : ''}
                  <input type="password" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} required={!editingUserId} />
                </label>
                <div className="grid-two nocodb-config-grid">
                  <label>
                    Ruolo
                    <select value={userForm.role} onChange={(event) => setUserForm({ ...userForm, role: event.target.value })}>
                      <option value="admin">admin</option>
                      <option value="editor">editor</option>
                      <option value="viewer">viewer</option>
                    </select>
                  </label>
                  <label>
                    Stato
                    <select value={userForm.is_active ? 'active' : 'inactive'} onChange={(event) => setUserForm({ ...userForm, is_active: event.target.value === 'active' })}>
                      <option value="active">attivo</option>
                      <option value="inactive">disattivo</option>
                    </select>
                  </label>
                </div>
                <div className="section-row slim-row">
                  <button type="submit" className="full-width">{editingUserId ? 'Salva utente' : 'Crea utente'}</button>
                  {editingUserId ? <button type="button" className="ghost-button" onClick={() => { setEditingUserId(null); setUserForm(initialUserForm) }}>Annulla</button> : null}
                </div>
              </form>
            ) : <p className="muted compact-text">Solo gli amministratori possono creare, modificare o eliminare utenti.</p>}
            <div className="locations-list users-compact-list">
              {users.map((user) => (
                <div className="sub-card compact-text" key={user.id}>
                  <div className="result-card-top">
                    <strong>{user.username}</strong>
                    <span className={`role-pill role-${user.role}`}>{user.role}</span>
                  </div>
                  <div className="muted">{user.email}</div>
                  {isAdmin ? (
                    <div className="section-row slim-row">
                      <button type="button" className="ghost-button" onClick={() => startEditUser(user)}>Modifica</button>
                      {currentUser?.id !== user.id ? <button type="button" className="danger" onClick={() => deleteUser(user.id)}>Elimina</button> : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <SectionCard title="Impostazioni e import/export" subtitle="Panoramica contatori e strumenti di scambio dati.">
          <div className="cards-grid">
            <div className="sub-card"><h3>{stats.locations}</h3><p className="muted compact-text">Punti</p></div>
            <div className="sub-card"><h3>{stats.categories}</h3><p className="muted compact-text">Tab</p></div>
            <div className="sub-card"><h3>{stats.attachments}</h3><p className="muted compact-text">Allegati</p></div>
            <div className="sub-card"><h3>{stats.users}</h3><p className="muted compact-text">Utenti</p></div>
          </div>
          <div className="section-row wrap-row">
            <button type="button" className="full-width settings-action" onClick={downloadExport}>Esporta JSON</button>
            {isAdmin ? <button type="button" className="ghost-button settings-action" onClick={() => importInputRef.current?.click()}>Importa JSON</button> : null}
            <input ref={importInputRef} type="file" accept="application/json" className="hidden-input" onChange={importJson} />
          </div>
        </SectionCard>
      </div>
    )
  }

  function renderPage() {
    if (page === 'home') return renderHome()
    if (page === 'new-point') return renderNewPoint()
    if (page === 'points') return renderPoints()
    if (page === 'search') return renderSearch()
    if (page === 'settings') return renderSettings()
    return renderHome()
  }

  if (!token || !currentUser) {
    return <LoginScreen form={loginForm} setForm={setLoginForm} onSubmit={handleLogin} status={status} loading={loginLoading || authLoading} />
  }

  return (
    <div className="app-shell app-shell-rail">
      <aside className="nav-rail">
        <div className="nav-rail-top">
          {availableNavItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`rail-button ${page === item.key ? 'active' : ''}`}
              title={item.label}
              onClick={() => { setPage(item.key); if (item.key === 'home') setHomeDetailsOpen(false) }}
            >
              <span className="rail-icon" aria-hidden="true">{item.icon}</span>
            </button>
          ))}
        </div>
        <div className="nav-rail-bottom">
          <span className={`role-pill role-${currentUser.role}`}>{currentUser.role}</span>
          <button className="rail-button logout-button" type="button" title="Logout" onClick={() => logout()}>
            <span className="rail-icon">⎋</span>
          </button>
        </div>
      </aside>

      <main className="page-shell rail-page-shell">
        {status ? <div className={`status-banner status-banner-${statusTone}`}>{status}</div> : null}
        {renderPage()}
      </main>
    </div>
  )
}
