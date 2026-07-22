(() => {
  'use strict';

  const TH_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const TH_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const TH_DAYS = ['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์'];
  const TH_DAYS_SHORT = ['จ','อ','พ','พฤ','ศ','ส','อา'];

  const fallbackHolidays = [
    ['2026-01-01','วันขึ้นปีใหม่'],
    ['2026-01-02','วันหยุดพิเศษ'],
    ['2026-04-06','วันจักรี'],
    ['2026-04-13','วันสงกรานต์'],
    ['2026-04-14','วันสงกรานต์'],
    ['2026-04-15','วันสงกรานต์'],
    ['2026-05-04','วันฉัตรมงคล'],
    ['2026-06-03','วันเฉลิมพระชนมพรรษาสมเด็จพระนางเจ้าฯ พระบรมราชินี'],
    ['2026-07-28','วันเฉลิมพระชนมพรรษาพระบาทสมเด็จพระเจ้าอยู่หัว'],
    ['2026-08-12','วันแม่แห่งชาติ'],
    ['2026-10-13','วันนวมินทรมหาราช'],
    ['2026-10-23','วันปิยมหาราช'],
    ['2026-12-05','วันพ่อแห่งชาติ'],
    ['2026-12-10','วันรัฐธรรมนูญ'],
    ['2026-12-31','วันสิ้นปี']
  ].map(([holiday_date, name]) => ({ holiday_date, name }));

  const state = {
    view: 'month',
    focusDate: startOfDay(new Date()),
    appointments: [],
    holidays: fallbackHolidays,
    client: null,
    loaded: false,
    databaseReady: true
  };

  const el = {};
  let toastTimer;
  let realtimeChannel;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheElements();
    bindEvents();
    el.todayLabel.textContent = formatThaiFullDate(new Date());
    renderLoading();
    await connectAndLoad();
    render();
  }

  function cacheElements() {
    [
      'viewRoot','periodTitle','todayLabel','connectionDot','connectionText','prevPeriod','nextPeriod','todayBtn',
      'addAppointmentBtn','appointmentDialog','appointmentForm','dialogTitle','appointmentId','titleInput','dateInput',
      'allDayInput','startTimeInput','endTimeInput','locationInput','dressInput','participantsInput','noteInput',
      'editorInput','saveAppointmentBtn','closeDialogBtn','cancelDialogBtn','toast','setupNotice','shareBtn','eventCardTemplate'
    ].forEach(id => { el[id] = document.getElementById(id); });
    el.viewTabs = [...document.querySelectorAll('.view-tab')];
  }

  function bindEvents() {
    el.viewTabs.forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
    el.prevPeriod.addEventListener('click', () => movePeriod(-1));
    el.nextPeriod.addEventListener('click', () => movePeriod(1));
    el.todayBtn.addEventListener('click', () => { state.focusDate = startOfDay(new Date()); render(); });
    el.addAppointmentBtn.addEventListener('click', () => openDialog(null, toISODate(new Date())));
    el.closeDialogBtn.addEventListener('click', closeDialog);
    el.cancelDialogBtn.addEventListener('click', closeDialog);
    el.allDayInput.addEventListener('change', syncTimeFields);
    el.appointmentForm.addEventListener('submit', saveAppointment);
    el.shareBtn.addEventListener('click', sharePage);
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
  }

  async function connectAndLoad() {
    const cfg = window.SUPABASE_CONFIG || {};
    if (!window.supabase || !cfg.url || !cfg.anonKey || cfg.url.includes('ใส่_')) {
      setConnection('error', 'ยังไม่ได้ตั้งค่า Supabase — แสดงโหมดตัวอย่าง');
      state.databaseReady = false;
      state.loaded = true;
      return;
    }

    try {
      state.client = window.supabase.createClient(cfg.url, cfg.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      await loadData();
      subscribeRealtime();
      setConnection('online', 'เชื่อมต่อฐานข้อมูลแล้ว');
    } catch (error) {
      console.error(error);
      state.databaseReady = false;
      setConnection('error', 'เชื่อมต่อไม่สำเร็จ — โปรดตรวจสอบฐานข้อมูล');
    } finally {
      state.loaded = true;
      el.setupNotice.classList.toggle('hidden', state.databaseReady);
    }
  }

  async function loadData() {
    const appointmentsQuery = state.client
      .from('appointments')
      .select('id,appointment_date,end_date,start_time,end_time,is_all_day,title,location,dress_code,participants,note,created_by,updated_by,created_at,updated_at')
      .order('appointment_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: true });

    const holidaysQuery = state.client
      .from('holidays')
      .select('holiday_date,name')
      .order('holiday_date', { ascending: true });

    const [appointmentsResult, holidaysResult] = await Promise.all([appointmentsQuery, holidaysQuery]);

    if (appointmentsResult.error) {
      const message = String(appointmentsResult.error.message || '');
      if (message.includes('appointments') || message.includes('schema cache') || message.includes('relation')) {
        state.databaseReady = false;
      }
      throw appointmentsResult.error;
    }

    state.appointments = appointmentsResult.data || [];
    if (!holidaysResult.error && holidaysResult.data?.length) {
      state.holidays = holidaysResult.data;
    }
  }

  function subscribeRealtime() {
    if (!state.client) return;
    if (realtimeChannel) state.client.removeChannel(realtimeChannel);
    realtimeChannel = state.client
      .channel('donchan-appointments-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, async () => {
        try { await loadData(); render(); } catch (error) { console.error(error); }
      })
      .subscribe();
  }

  function updateConnectivity() {
    if (!navigator.onLine) setConnection('error', 'ออฟไลน์ — รอเชื่อมต่ออินเทอร์เน็ต');
    else if (state.client && state.databaseReady) setConnection('online', 'เชื่อมต่อฐานข้อมูลแล้ว');
  }

  function setConnection(type, text) {
    el.connectionDot.className = `status-dot ${type || ''}`;
    el.connectionText.textContent = text;
  }

  function setView(view) {
    state.view = view;
    el.viewTabs.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    render();
  }

  function movePeriod(direction) {
    const date = new Date(state.focusDate);
    if (state.view === 'week') date.setDate(date.getDate() + direction * 7);
    if (state.view === 'month') date.setMonth(date.getMonth() + direction, 1);
    if (state.view === 'year') date.setFullYear(date.getFullYear() + direction, 0, 1);
    state.focusDate = startOfDay(date);
    render();
  }

  function renderLoading() {
    el.viewRoot.innerHTML = '<div class="loading">กำลังโหลดตารางนัดหมาย…</div>';
  }

  function render() {
    if (!state.loaded) return renderLoading();
    updatePeriodTitle();
    if (state.view === 'week') renderWeek();
    else if (state.view === 'year') renderYear();
    else renderMonth();
  }

  function updatePeriodTitle() {
    const y = state.focusDate.getFullYear() + 543;
    if (state.view === 'week') {
      const start = getMonday(state.focusDate);
      const end = addDays(start, 6);
      el.periodTitle.textContent = `${start.getDate()} ${TH_MONTHS_SHORT[start.getMonth()]} – ${end.getDate()} ${TH_MONTHS_SHORT[end.getMonth()]} ${end.getFullYear() + 543}`;
    } else if (state.view === 'month') {
      el.periodTitle.textContent = `${TH_MONTHS[state.focusDate.getMonth()]} ${y}`;
    } else {
      el.periodTitle.textContent = `ปี ${y}`;
    }
  }

  function renderMonth() {
    const year = state.focusDate.getFullYear();
    const month = state.focusDate.getMonth();
    const first = new Date(year, month, 1);
    const gridStart = getMonday(first);
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    const monthEvents = state.appointments.filter(a => {
      const d = parseISODate(a.appointment_date);
      return d.getFullYear() === year && d.getMonth() === month;
    });

    const root = document.createElement('div');
    root.className = 'calendar-card';
    root.innerHTML = `
      <div class="weekday-row">${TH_DAYS_SHORT.map(d => `<span>${d}</span>`).join('')}</div>
      <div class="month-grid"></div>
      <div class="section-head"><h2>รายการนัดหมายเดือนนี้</h2><span>${monthEvents.length} รายการ</span></div>
      <div class="event-list"></div>
    `;

    const grid = root.querySelector('.month-grid');
    days.forEach(day => {
      const iso = toISODate(day);
      const holiday = getHoliday(iso);
      const events = getEventsForDate(iso);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'day-cell';
      if (day.getMonth() !== month) button.classList.add('other-month');
      if (isSameDay(day, new Date())) button.classList.add('today');
      if (holiday || [0,6].includes(day.getDay())) button.classList.add('holiday');
      button.setAttribute('aria-label', `${formatThaiFullDate(day)} ${events.length ? `${events.length} นัดหมาย` : ''}`);
      button.innerHTML = `
        <span class="day-number">${day.getDate()}</span>
        ${holiday ? `<span class="holiday-label">${escapeHTML(holiday.name)}</span>` : ''}
        ${events.length ? `<span class="event-dots">${Array.from({length: Math.min(events.length,3)}, () => '<i class="event-dot"></i>').join('')}${events.length > 3 ? `<b class="event-count">+${events.length-3}</b>` : ''}</span>` : ''}
      `;
      button.addEventListener('click', () => openDialog(null, iso));
      grid.appendChild(button);
    });

    renderEventList(root.querySelector('.event-list'), monthEvents);
    el.viewRoot.replaceChildren(root);
  }

  function renderWeek() {
    const start = getMonday(state.focusDate);
    const root = document.createElement('div');
    root.className = 'week-view';

    for (let i = 0; i < 7; i++) {
      const day = addDays(start, i);
      const iso = toISODate(day);
      const holiday = getHoliday(iso);
      const events = getEventsForDate(iso);
      const section = document.createElement('section');
      section.className = 'week-day';
      section.innerHTML = `
        <button type="button" class="week-day-head ${holiday ? 'holiday' : ''}">
          <span>${TH_DAYS[i]} ${day.getDate()} ${TH_MONTHS_SHORT[day.getMonth()]}</span>
          <span>${holiday ? escapeHTML(holiday.name) : `${events.length} รายการ`}</span>
        </button>
        <div class="week-day-events"></div>
      `;
      section.querySelector('.week-day-head').addEventListener('click', () => openDialog(null, iso));
      const list = section.querySelector('.week-day-events');
      if (events.length) renderEventList(list, events);
      else list.innerHTML = '<div class="empty-state" style="min-height:55px;padding:10px">ไม่มีนัดหมาย</div>';
      root.appendChild(section);
    }
    el.viewRoot.replaceChildren(root);
  }

  function renderYear() {
    const year = state.focusDate.getFullYear();
    const root = document.createElement('div');
    root.className = 'year-grid';

    for (let month = 0; month < 12; month++) {
      const monthStart = new Date(year, month, 1);
      const gridStart = getMonday(monthStart);
      const eventsInMonth = state.appointments.filter(a => {
        const d = parseISODate(a.appointment_date);
        return d.getFullYear() === year && d.getMonth() === month;
      });
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mini-month';
      let cells = TH_DAYS_SHORT.map(d => `<span class="mini-head">${d}</span>`).join('');
      for (let i = 0; i < 42; i++) {
        const day = addDays(gridStart, i);
        const current = day.getMonth() === month;
        const iso = toISODate(day);
        const hasEvent = current && getEventsForDate(iso).length > 0;
        const holiday = current && (getHoliday(iso) || [0,6].includes(day.getDay()));
        cells += `<span class="${!current ? 'mini-other' : hasEvent ? 'mini-event' : holiday ? 'mini-holiday' : ''}">${day.getDate()}</span>`;
      }
      button.innerHTML = `<h3>${TH_MONTHS[month]} <span>${eventsInMonth.length} นัด</span></h3><div class="mini-grid">${cells}</div>`;
      button.addEventListener('click', () => {
        state.focusDate = new Date(year, month, 1);
        setView('month');
      });
      root.appendChild(button);
    }
    el.viewRoot.replaceChildren(root);
  }

  function renderEventList(container, events) {
    const sorted = [...events].sort(compareAppointments);
    if (!sorted.length) {
      container.innerHTML = '<div class="empty-state"><div><strong>ยังไม่มีรายการนัดหมาย</strong>แตะปุ่ม “เพิ่มนัดหมาย” เพื่อบันทึกกิจกรรม</div></div>';
      return;
    }
    container.replaceChildren(...sorted.map(createEventCard));
  }

  function createEventCard(event) {
    const fragment = el.eventCardTemplate.content.cloneNode(true);
    const card = fragment.querySelector('.event-card');
    const date = parseISODate(event.appointment_date);
    card.dataset.id = event.id;
    card.querySelector('.event-datebox strong').textContent = date.getDate();
    card.querySelector('.event-datebox span').textContent = TH_MONTHS_SHORT[date.getMonth()];
    card.querySelector('h3').textContent = event.title;
    card.querySelector('.event-time').textContent = event.is_all_day ? 'ตลอดวัน' : formatTimeRange(event.start_time, event.end_time);
    card.querySelector('.event-details').innerHTML = [
      event.location ? ['📍', event.location] : null,
      event.dress_code ? ['👔', event.dress_code] : null,
      event.participants ? ['👥', event.participants] : null,
      event.note ? ['📝', event.note] : null
    ].filter(Boolean).map(([icon, text]) => `<div><dt>${icon}</dt><dd>${escapeHTML(text)}</dd></div>`).join('');
    card.querySelector('.edit-event').addEventListener('click', () => openDialog(event));
    return card;
  }

  function openDialog(event = null, presetDate = null) {
    if (!state.client || !state.databaseReady) {
      showToast('กรุณารันไฟล์ supabase-schema.sql และตรวจสอบการเชื่อมต่อก่อนบันทึก', true);
      if (!state.client) return;
    }

    el.appointmentForm.reset();
    el.appointmentId.value = event?.id || '';
    el.dialogTitle.textContent = event ? 'แก้ไขนัดหมาย' : 'เพิ่มนัดหมาย';
    el.saveAppointmentBtn.textContent = event ? 'บันทึกการแก้ไข' : 'บันทึกนัดหมาย';
    el.titleInput.value = event?.title || '';
    el.dateInput.value = event?.appointment_date || presetDate || toISODate(new Date());
    el.allDayInput.checked = Boolean(event?.is_all_day);
    el.startTimeInput.value = trimTime(event?.start_time) || '';
    el.endTimeInput.value = trimTime(event?.end_time) || '';
    el.locationInput.value = event?.location || '';
    el.dressInput.value = event?.dress_code || '';
    el.participantsInput.value = event?.participants || '';
    el.noteInput.value = event?.note || '';
    el.editorInput.value = event?.updated_by || event?.created_by || localStorage.getItem('donchan_editor_name') || '';
    syncTimeFields();
    el.appointmentDialog.showModal();
    setTimeout(() => el.titleInput.focus(), 80);
  }

  function closeDialog() {
    if (el.appointmentDialog.open) el.appointmentDialog.close();
  }

  function syncTimeFields() {
    const disabled = el.allDayInput.checked;
    [el.startTimeInput, el.endTimeInput].forEach(input => { input.disabled = disabled; });
    document.querySelectorAll('.time-field').forEach(field => field.classList.toggle('disabled', disabled));
  }

  async function saveAppointment(event) {
    event.preventDefault();
    if (!el.appointmentForm.reportValidity()) return;
    if (!state.client || !state.databaseReady) {
      showToast('ยังไม่สามารถบันทึกได้ กรุณาตั้งค่าฐานข้อมูลก่อน', true);
      return;
    }

    const id = el.appointmentId.value;
    const editor = el.editorInput.value.trim() || 'ไม่ระบุชื่อ';
    const payload = {
      appointment_date: el.dateInput.value,
      end_date: null,
      start_time: el.allDayInput.checked ? null : (el.startTimeInput.value || null),
      end_time: el.allDayInput.checked ? null : (el.endTimeInput.value || null),
      is_all_day: el.allDayInput.checked,
      title: el.titleInput.value.trim(),
      location: el.locationInput.value.trim(),
      dress_code: el.dressInput.value.trim() || null,
      participants: el.participantsInput.value.trim(),
      note: el.noteInput.value.trim() || null,
      status: 'กำหนดการ'
    };

    if (!id) payload.created_by = editor;
    else payload.updated_by = editor;

    localStorage.setItem('donchan_editor_name', editor);
    el.saveAppointmentBtn.disabled = true;
    el.saveAppointmentBtn.textContent = 'กำลังบันทึก…';

    try {
      const query = id
        ? state.client.from('appointments').update(payload).eq('id', id)
        : state.client.from('appointments').insert(payload);
      const { error } = await query;
      if (error) throw error;
      await loadData();
      state.focusDate = parseISODate(payload.appointment_date);
      closeDialog();
      render();
      showToast(id ? 'แก้ไขรายการเรียบร้อยแล้ว' : 'เพิ่มนัดหมายเรียบร้อยแล้ว');
    } catch (error) {
      console.error(error);
      showToast(`บันทึกไม่สำเร็จ: ${error.message || 'โปรดลองอีกครั้ง'}`, true);
    } finally {
      el.saveAppointmentBtn.disabled = false;
      el.saveAppointmentBtn.textContent = id ? 'บันทึกการแก้ไข' : 'บันทึกนัดหมาย';
    }
  }

  async function sharePage() {
    const shareData = {
      title: 'ตารางนัดหมายสำนักงานปศุสัตว์อำเภอดอนจาน',
      text: 'เปิดดูและบันทึกตารางนัดหมายสำนักงานปศุสัตว์อำเภอดอนจาน',
      url: location.href
    };
    try {
      if (navigator.share) await navigator.share(shareData);
      else {
        await navigator.clipboard.writeText(location.href);
        showToast('คัดลอกลิงก์แล้ว');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('ไม่สามารถแชร์ลิงก์ได้', true);
    }
  }

  function getEventsForDate(iso) {
    return state.appointments.filter(event => event.appointment_date === iso).sort(compareAppointments);
  }

  function getHoliday(iso) {
    return state.holidays.find(item => item.holiday_date === iso) || null;
  }

  function compareAppointments(a, b) {
    return `${a.appointment_date} ${a.start_time || '00:00'}`.localeCompare(`${b.appointment_date} ${b.start_time || '00:00'}`);
  }

  function formatTimeRange(start, end) {
    const s = trimTime(start);
    const e = trimTime(end);
    if (s && e) return `เวลา ${s}–${e} น.`;
    if (s) return `เวลา ${s} น.`;
    return 'ไม่ระบุเวลา';
  }

  function trimTime(value) {
    return value ? String(value).slice(0,5) : '';
  }

  function formatThaiFullDate(date) {
    const dayIndex = (date.getDay() + 6) % 7;
    return `${TH_DAYS[dayIndex]}ที่ ${date.getDate()} ${TH_MONTHS[date.getMonth()]} ${date.getFullYear() + 543}`;
  }

  function getMonday(date) {
    const d = startOfDay(date);
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    return d;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function parseISODate(value) {
    const [y,m,d] = String(value).split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function toISODate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
  }

  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.classList.toggle('error', isError);
    el.toast.classList.add('show');
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3000);
  }
})();
