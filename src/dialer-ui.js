(function (root) {
  'use strict';
  class DialerUI {
    constructor({ container, api, hooks }) {
      this.container = container; this.api = api; this.hooks = hooks;
      this.epoch = 0; this.context = null; this.call = null; this.media = null;
      this.scripts = []; this.numbers = []; this.active = false; this.ending = false;
      container.innerHTML = `
        <header class="dialer-head"><div><h1>Call workspace</h1><p class="muted">Review the contact and script before calling.</p></div><button id="dc-collapse">Minimize workspace</button></header>
        <div id="dc-status" class="dialer-status" role="status" aria-live="polite"></div>
        <div class="dialer-grid">
          <section class="dialer-card"><h2>1. Choose a contact</h2><fieldset id="dc-contact-fields">
            <button id="dc-meeting" class="wide">Use current meeting</button>
            <form id="dc-search-form"><label for="dc-query">Search contacts</label><div class="dialer-row"><input id="dc-query" placeholder="Name or email" maxlength="200"><button type="submit">Search</button></div></form>
            <div id="dc-people" class="person-list" aria-label="Contact results"></div><button id="dc-more-people" hidden>Load more contacts</button>
          </fieldset><h3 id="dc-person-name">No contact selected</h3><p id="dc-person-detail" class="muted">Choose a contact or your current meeting.</p><p id="dc-context-detail" class="muted"></p></section>
          <section class="dialer-card"><h2>2. Prepare the call</h2><fieldset id="dc-config-fields">
            <label for="dc-destination">Call to</label><select id="dc-destination"><option value="">Select a contact first</option></select>
            <label for="dc-caller">Call from</label><select id="dc-caller"><option value="">Loading numbers…</option></select><button id="dc-more-numbers" class="wide" hidden>Load more numbers</button>
            <label for="dc-script">Call script</label><select id="dc-script"><option value="">Choose a script</option></select><p id="dc-script-source" class="muted"></p>
            <div class="dialer-row"><button id="dc-new-script">New script</button><button id="dc-edit-script">Edit script</button></div><button id="dc-more-scripts" class="wide" hidden>Load more scripts</button>
            <button id="dc-review" class="primary wide" disabled>Review call</button>
            <form id="dc-editor" hidden><h3 id="dc-editor-heading">New script</h3>
              <label for="dc-title">Title</label><input id="dc-title" maxlength="160" required>
              <label for="dc-opening">Opening</label><textarea id="dc-opening" required></textarea>
              <label for="dc-questions">Questions · one per line</label><textarea id="dc-questions"></textarea>
              <label for="dc-objections">Objection guidance · one per line</label><textarea id="dc-objections"></textarea>
              <label for="dc-next">Next step</label><textarea id="dc-next"></textarea>
              <p class="muted">Use {{person.full_name}} or {{company.name}} for contact details.</p>
              <div class="dialer-row"><button type="submit" class="primary">Save script</button><button id="dc-editor-cancel" type="button">Cancel</button></div>
            </form>
          </fieldset>
          <details><summary>Add a phone number</summary><p id="dc-price" class="muted">Checking availability…</p><label for="dc-area">US area code (optional)</label><input id="dc-area" inputmode="numeric" pattern="[0-9]{3}" maxlength="3" placeholder="312"><button id="dc-checkout" class="wide" disabled>Continue to checkout</button><button id="dc-check-purchase" class="wide" hidden>Check number status</button></details></section>
          <section class="dialer-card review-card"><div class="dialer-row"><h2>3. Review and call</h2><span id="dc-call-state" class="badge">Not started</span></div>
            <p id="dc-call-summary" class="muted">Your destination, caller number and script will appear here.</p><pre id="dc-preview" class="script-preview"></pre>
            <p class="muted">Live transcription starts with the call. Confirm consent requirements before continuing.</p>
            <button id="dc-start" class="primary wide" disabled>Start call</button><button id="dc-end" class="danger wide" hidden>End call</button><button id="dc-check-call" class="wide" hidden>Check call status</button><button id="dc-playback" class="wide" hidden>Enable call audio</button>
            <p class="muted">Live coaching appears in the coach panel. Use Transcript or Summary in the top bar during or after the call.</p>
          </section>
        </div>`;
      this.el = (id) => container.querySelector(`#dc-${id}`);
      const action = (id, fn) => this.el(id).addEventListener('click', () => this.run(fn));
      action('collapse', () => this.toggle(false)); action('meeting', () => this.choose(this.hooks.selection()));
      action('review', () => this.review()); action('start', () => this.start()); action('end', () => this.end());
      action('check-call', async () => {
        const result = await this.request('callingGetCall', this.call.call_id); this.call.state = result.call.state;
        if (!['ended','failed','cancelled'].includes(this.call.state)) this.call.state = 'reconciliation_required';
        this.status(this.call.state === 'reconciliation_required' ? 'The call outcome is not confirmed yet. Check again shortly.' : 'Call ended. You can prepare another call.'); this.controls();
      });
      action('new-script', () => this.edit(null)); action('edit-script', () => this.edit(this.script()));
      action('editor-cancel', () => { this.el('editor').hidden = true; });
      action('more-people', () => this.search(true)); action('more-scripts', () => this.loadScripts(true));
      action('more-numbers', () => this.loadNumbers(true)); action('checkout', () => this.checkout());
      action('check-purchase', () => this.checkPurchase()); action('playback', async () => { await this.media?.playback.play(); this.el('playback').hidden = true; });
      this.el('search-form').addEventListener('submit', (event) => { event.preventDefault(); this.run(() => this.search()); });
      this.el('editor').addEventListener('submit', (event) => { event.preventDefault(); this.run(() => this.saveScript()); });
      for (const id of ['destination', 'caller', 'script']) this.el(id).addEventListener('change', () => { this.invalidate(); this.controls(); });
      api.onCallingMediaUpdate((update) => this.update(update));
      api.onCallingMediaClosed((update) => { if (this.call?.call_id === update.call_id) this.finish(update.state); });
    }
    status(text, error = false) { this.el('status').textContent = text; this.el('status').dataset.error = String(error); }
    async run(fn) { try { await fn(); } catch (error) { this.status(this.friendly(error), true); } finally { this.controls(); } }
    friendly(error) {
      const text = String(error?.message || '');
      if (text.includes('context_changed')) return 'Contact details changed. Select the contact again and review the call.';
      if (text.includes('missing_variable')) return 'This script needs contact details that are missing. Update the contact or edit the script.';
      if (text.includes('401') || text.includes('auth_required')) return 'Sign in to your workspace first.';
      if (text.includes('403')) return 'Your workspace role does not allow this action.';
      if (text.includes('NotAllowed')) return 'Microphone access was denied. Enable access in system settings.';
      if (text.includes('changed')) return 'The selection changed. Please try again.';
      return 'Could not complete that action. Refresh the contact and try again.';
    }
    async request(method, ...args) {
      const epoch = this.epoch; const result = await this.api[method](...args);
      if (epoch !== this.epoch) throw new Error('selection_changed');
      if (!result?.success) throw new Error(result?.error || 'request_failed');
      return result;
    }
    async toggle(open) {
      await this.api.callingSetExpanded(open); this.container.hidden = !open;
      if (open && !this.loaded) {
        this.status('Loading your workspace…');
        await Promise.all([this.search(), this.loadScripts(), this.loadNumbers(), this.loadPrice()]);
        this.loaded = true; this.status('Choose a contact to begin.'); this.controls();
      }
    }
    option(select, value, label, disabled = false) { const opt = document.createElement('option'); opt.value = value; opt.textContent = label; opt.disabled = disabled; select.append(opt); }
    async search(more = false) {
      const query = this.el('query').value.trim();
      if (more && query !== this.searchQuery) return this.search(false);
      const response = await this.request('callingSearchPeople', { query, ...(more && this.peopleCursor ? { cursor: this.peopleCursor } : {}) });
      if (query !== this.el('query').value.trim()) return;
      this.searchQuery = query; if (!more) this.el('people').replaceChildren();
      for (const person of response.people || []) {
        const button = document.createElement('button'); button.textContent = `${person.full_name || person.name || person.email || 'Contact'}${person.company_name ? ' · ' + person.company_name : ''}`;
        button.type = 'button'; button.dataset.personId = person.person_id; button.setAttribute('aria-pressed', String(person.person_id === this.context?.person_id));
        button.addEventListener('click', () => this.run(() => this.choose({ personId: person.person_id }))); this.el('people').append(button);
      }
      this.peopleCursor = response.next_cursor; this.el('more-people').hidden = !this.peopleCursor;
      if (!this.el('people').children.length) this.el('people').textContent = 'No contacts found.';
    }
    invalidate() {
      this.epoch++;
      if (this.call && !this.active) this.api.callingCancelCall(this.call.call_id).catch(() => {});
      this.call = null; this.el('preview').textContent = ''; this.el('call-summary').textContent = 'Review the updated selection before calling.'; this.el('call-state').textContent = 'Not started';
    }
    async choose(selection) {
      if (this.active || this.stopping || this.call?.state === 'reconciliation_required') return;
      if (!selection || !Object.values(selection).some(Boolean)) { this.status('No current meeting. Search for a contact instead.'); return; }
      this.invalidate(); this.context = null; this.controls();
      const response = await this.request('callingGetContext', selection); this.context = response.context;
      this.el('person-name').textContent = this.context.person?.full_name || this.context.person?.name || 'Selected contact';
      this.el('person-detail').textContent = [this.context.person?.title, this.context.company?.name, this.context.person?.email].filter(Boolean).join(' · ');
      this.el('context-detail').textContent = this.context.pipeline_context || this.context.business_context || 'Contact details loaded.';
      const select = this.el('destination'); select.replaceChildren(); this.option(select, '', 'Choose a destination');
      for (const candidate of this.context.phone_candidates || []) this.option(select, candidate.number_id, candidate.number + (candidate.eligible ? '' : ' · Unavailable'), !candidate.eligible);
      const eligible = (this.context.phone_candidates || []).filter((row) => row.eligible); if (eligible.length === 1) select.value = eligible[0].number_id;
      this.container.querySelectorAll('[data-person-id]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.personId === this.context.person_id)));
      this.status(eligible.length ? 'Contact loaded. Choose a caller number and script.' : 'This contact has no eligible phone number.'); this.controls();
    }
    async loadScripts(more = false) {
      const response = await this.request('callingListScripts', more && this.scriptCursor ? { cursor: this.scriptCursor } : {});
      this.scripts = more ? [...this.scripts, ...response.scripts] : response.scripts || []; this.scriptCursor = response.next_cursor;
      const select = this.el('script'), selected = select.value; select.replaceChildren(); this.option(select, '', 'Choose a script');
      for (const script of this.scripts) this.option(select, script.template_id, `${script.title} · v${script.revision}`);
      select.value = selected; this.el('more-scripts').hidden = !this.scriptCursor; this.controls();
    }
    async loadNumbers(more = false) {
      const response = await this.request('callingListNumbers', more && this.numberCursor ? { cursor: this.numberCursor } : {});
      this.numbers = more ? [...this.numbers, ...response.numbers] : response.numbers || []; this.numberCursor = response.next_cursor;
      const select = this.el('caller'), selected = select.value; select.replaceChildren(); this.option(select, '', 'Choose a caller number');
      const active = this.numbers.filter((number) => number.status === 'active');
      for (const number of active) this.option(select, number.number_id, number.number + (number.local_only ? ' · Local test' : ''));
      select.value = selected || (active.length === 1 ? active[0].number_id : ''); this.el('more-numbers').hidden = !this.numberCursor; this.controls();
    }
    script() { return this.scripts.find((row) => row.template_id === this.el('script').value); }
    controls() {
      const locked = this.active || this.stopping || this.reviewing || this.call?.state === 'reconciliation_required';
      const script = this.script(); this.el('script-source').textContent = script ? `Version ${script.revision} · ${script.source === 'local_agent' ? 'Local agent' : 'User'} template` : '';
      this.el('review').disabled = locked || !this.context || !this.el('destination').value || !this.el('caller').value || !script;
      this.el('start').disabled = locked || !this.call || this.call.state !== 'prepared';
      this.el('end').hidden = !this.active; this.el('end').disabled = this.ending;
      this.el('contact-fields').disabled = locked; this.el('config-fields').disabled = locked;
      this.el('check-call').hidden = this.call?.state !== 'reconciliation_required';
      this.el('edit-script').disabled = !script;
    }
    async review() {
      if (this.active || this.stopping || this.reviewing || this.call?.state === 'reconciliation_required') return;
      this.reviewing = true; this.controls();
      try {
      this.invalidate(); const context = this.context, script = this.script();
      const caller = this.numbers.find((row) => row.number_id === this.el('caller').value);
      const response = await this.request('callingPrepareCall', {
        person_id: context.person_id, ...(context.pipeline_id ? { pipeline_id: context.pipeline_id } : {}), ...(context.event_id ? { event_id: context.event_id } : {}),
        context_snapshot_id: context.context_snapshot_id, number_id: this.el('destination').value, caller_number_id: caller.number_id,
        script_template_id: script.template_id, script_revision: script.revision, mode: caller.local_only ? 'local_test' : 'live', confirmed: true, idempotency_key: crypto.randomUUID(),
      });
      this.call = response.call; const rendered = this.call.rendered_script;
      this.el('call-summary').textContent = `${this.call.destination} · From ${this.call.caller_number}`;
      this.el('preview').textContent = [rendered.title, rendered.opening, ...(rendered.questions || []), ...(rendered.objection_guidance || []), rendered.next_step].filter(Boolean).join('\n\n');
      this.el('call-state').textContent = 'Ready'; this.status('Review the numbers and script, then start the call.'); this.controls();
      } finally { this.reviewing = false; this.controls(); }
    }
    edit(script) {
      this.editing = script || null; this.el('editor').hidden = false; this.el('editor-heading').textContent = script ? 'Edit script' : 'New script';
      for (const [id, field] of [['title','title'],['opening','opening'],['questions','questions'],['objections','objection_guidance'],['next','next_step']]) this.el(id).value = Array.isArray(script?.[field]) ? script[field].join('\n') : script?.[field] || '';
      this.el('title').focus();
    }
    async saveScript() {
      const lines = (id) => this.el(id).value.split('\n').map((line) => line.trim()).filter(Boolean);
      const content = { title: this.el('title').value.trim(), opening: this.el('opening').value.trim(), questions: lines('questions'), objection_guidance: lines('objections'), next_step: this.el('next').value.trim() };
      const result = this.editing ? await this.request('callingUpdateScript', this.editing.template_id, { ...content, expected_revision: this.editing.revision }) : await this.request('callingCreateScript', content);
      this.invalidate(); await this.loadScripts(); this.el('script').value = result.script.template_id; this.el('editor').hidden = true; this.status('Script saved.');
    }
    async start() {
      if (this.active || this.stopping || !this.call || this.call.state !== 'prepared') return;
      const call = this.call, epoch = this.epoch; this.active = true; this.controls(); this.status('Connecting audio…');
      let queued = [], signalingReady = false, signalingAttempted = false, mixed;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
        if (epoch !== this.epoch) { stream.getTracks().forEach((track) => track.stop()); throw new Error('selection_changed'); }
        this.media = new root.CallMedia({
          onCandidate: (candidate) => { if (signalingReady) this.run(() => this.request('callingMediaTrickle', { callId: call.call_id, candidate })); else queued.push(candidate); },
          onMixedStream: (stream) => { mixed = stream; },
          onState: (state) => { if (state === 'playback_blocked') { this.el('playback').hidden = false; this.status('Enable call audio to hear the other person.'); } },
        });
        const offer = await this.media.start(stream); await this.hooks.listen(mixed, call);
        signalingAttempted = true;
        const started = await this.request('callingMediaStart', { callId: call.call_id, offer });
        if (started.state === 'reconciliation_required') throw new Error('call_uncertain');
        if (!this.active) return;
        signalingReady = true;
        for (const candidate of queued) await this.request('callingMediaTrickle', { callId: call.call_id, candidate }); queued = [];
        this.status('Call started. Live coaching is listening.');
      } catch (error) {
        if (signalingAttempted && epoch === this.epoch) await this.api.callingMediaClose(call.call_id).catch(() => {});
        if (epoch === this.epoch) await this.finish(signalingAttempted ? 'interrupted' : 'prepared');
        throw error;
      }
    }
    update(update) {
      if (update.call_id !== this.call?.call_id) return;
      const labels = { dialing:'Dialing', ringing:'Ringing', connected:'Connected', ended:'Ended', failed:'Failed', reconciliation_required:'Checking call status' };
      this.el('call-state').textContent = labels[update.state] || 'Connecting';
      for (const event of update.events || []) this.media?.receive(event).catch(() => this.status('Call audio was interrupted. End the call and try again.', true));
      if (['ended','failed','cancelled'].includes(update.state)) this.finish(update.state);
    }
    async end() {
      if (!this.call || this.ending) return; this.ending = true; this.controls();
      try { const result = await this.request('callingMediaEnd', this.call.call_id); await this.finish(result.state); }
      catch (error) { await this.finish('interrupted'); throw error; }
      finally { this.ending = false; this.controls(); }
    }
    async finish(reason, options) {
      const hadAudio = this.active || this.media;
      const media = this.media; this.media = null; this.active = false; this.ending = false;
      const terminal = ['ended','failed','cancelled'];
      if (this.call && !terminal.includes(this.call.state)) this.call.state = terminal.includes(reason) || reason === 'prepared' ? reason : 'reconciliation_required';
      this.el('call-state').textContent = this.call?.state === 'ended' ? 'Ended' : this.call?.state === 'prepared' ? 'Ready' : 'Call stopped';
      if (!hadAudio) { this.controls(); return; }
      this.stopping = true; this.controls();
      try { await Promise.all([media?.close(), this.hooks.stop(options)]); }
      finally { this.stopping = false; this.controls(); }
    }
    async reset() {
      this.epoch++; if (this.call && this.active) this.api.callingMediaClose(this.call.call_id).catch(() => {});
      await this.finish('interrupted', { endSession: false }); this.call = null; this.context = null; this.loaded = false; this.scripts = []; this.numbers = []; this.purchaseId = null; this.purchaseKey = null;
      this.price = null; this.peopleCursor = null; this.scriptCursor = null; this.numberCursor = null; this.searchQuery = null; this.editing = null;
      this.el('checkout').disabled = true; this.el('price').textContent = 'Checking availability…';
      this.el('status').textContent = ''; this.el('call-state').textContent = 'Not started'; this.el('playback').hidden = true;
      this.el('person-name').textContent = 'No contact selected'; this.el('person-detail').textContent = 'Choose a contact or your current meeting.';
      for (const id of ['context-detail','preview','people','script-source']) this.el(id).replaceChildren();
      for (const id of ['query','title','opening','questions','objections','next','area']) this.el(id).value = '';
      for (const id of ['destination','caller','script']) { this.el(id).replaceChildren(); this.option(this.el(id), '', 'Choose an option'); }
      this.el('editor').hidden = true; this.el('check-purchase').hidden = true;
      this.el('call-summary').textContent = 'Your destination, caller number and script will appear here.';
      this.container.hidden = true; this.controls();
    }
    async loadPrice() {
      try { const result = await this.request('callingNumberOptions'); this.price = result.available ? result.price : null; }
      catch (_) { this.price = null; }
      this.el('checkout').disabled = !this.price;
      this.el('price').textContent = this.price ? `${new Intl.NumberFormat(undefined, { style:'currency', currency:this.price.currency }).format(this.price.amount / 100)}${this.price.mode === 'subscription' ? ' / ' + (this.price.interval_count > 1 ? this.price.interval_count + ' ' : '') + this.price.interval : ' one-time'}` : 'Number purchases are not available for this workspace.';
    }
    async checkout() {
      if (!this.price) return;
      const area = this.el('area').value.trim(); if (area && !/^[2-9][0-9]{2}$/.test(area)) { this.status('Enter a valid three-digit US area code.', true); return; }
      this.purchaseKey = this.purchaseKey || crypto.randomUUID();
      const result = await this.request('callingBeginCheckout', { criteria:{ country:'US', ...(area ? { area_code:area } : {}) }, idempotency_key:this.purchaseKey, confirmed:true });
      this.purchaseId = result.request_id; this.el('check-purchase').hidden = false;
      const url = new URL(result.checkout_url); if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw new Error('checkout_unavailable');
      await this.api.authOpenExternal(url.href); this.status('Complete checkout in your browser, then check the number status.');
    }
    async checkPurchase() {
      let result = await this.request('callingGetNumberRequest', this.purchaseId);
      const row = result.request || result;
      if (row.status === 'reconciliation_required') result = await this.request('callingReconcileNumber', this.purchaseId);
      const status = (result.request || result).status;
      if (status === 'active') { await this.loadNumbers(); this.status('Your number is ready.'); this.purchaseKey = null; }
      else this.status('Your number is not ready yet. Check again shortly.');
    }
  }
  root.DialerUI = DialerUI;
})(globalThis);
