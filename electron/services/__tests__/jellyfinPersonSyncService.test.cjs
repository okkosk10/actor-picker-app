'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  SYNC_STATUS,
  normalizeMatchText,
  parseFlexibleList,
  buildJellyfinPersonOverview,
  resolveActorImage,
  computeActorSyncHash,
  findPersonCandidates,
  syncActor,
} = require('../jellyfinPersonSyncService.cjs')

function createMockDb(actor) {
  const state = {
    actor: { ...actor },
    updates: [],
  }

  return {
    state,
    prepare(sql) {
      if (sql.includes('SELECT * FROM actors WHERE id = ?')) {
        return {
          get(id) {
            return Number(id) === Number(state.actor.id) ? { ...state.actor } : null
          },
        }
      }

      if (sql.includes('UPDATE actors')) {
        return {
          run(...args) {
            const [
              jellyfin_person_id,
              jellyfin_sync_status,
              jellyfin_sync_hash,
              jellyfin_synced_at,
              jellyfin_sync_error,
              jellyfin_matched_name,
              jellyfin_match_method,
              jellyfin_image_synced_at,
              actorId,
            ] = args

            assert.equal(Number(actorId), Number(state.actor.id))
            state.actor = {
              ...state.actor,
              jellyfin_person_id,
              jellyfin_sync_status,
              jellyfin_sync_hash,
              jellyfin_synced_at,
              jellyfin_sync_error,
              jellyfin_matched_name,
              jellyfin_match_method,
              jellyfin_image_synced_at,
            }
            state.updates.push({ ...state.actor })
            return { changes: 1 }
          },
        }
      }

      throw new Error(`Unexpected SQL in mock DB: ${sql}`)
    },
  }
}

test('normalizeMatchText는 공백/대소문자/NFKC를 정규화한다', () => {
  assert.equal(normalizeMatchText('  Ａ  B  '), 'a b')
})

test('parseFlexibleList는 JSON 배열을 파싱하고 중복을 제거한다', () => {
  const list = parseFlexibleList('["A", "a", "B"]')
  assert.deepEqual(list, ['A', 'B'])
})

test('parseFlexibleList는 쉼표 문자열을 파싱한다', () => {
  const list = parseFlexibleList('A, B, A')
  assert.deepEqual(list, ['A', 'B'])
})

test('buildJellyfinPersonOverview는 빈 필드를 생략하고 메모 섹션을 구성한다', () => {
  const text = buildJellyfinPersonOverview({
    name: '스즈무라 아이리',
    agency: 'Eightman',
    category: '배우',
    aliases: '鈴村あいり, 아이리, 스즈무라 아이리',
    tags: 'OL, 상황극, OL',
    memo: '직장 역할극 계열 작품 선호',
  })

  assert.ok(text.includes('소속사: Eightman'))
  assert.ok(text.includes('분류: 배우'))
  assert.ok(text.includes('별칭: 鈴村あいり, 아이리'))
  assert.ok(text.includes('태그: OL, 상황극'))
  assert.ok(text.includes('액트픽커 메모:'))
  assert.ok(!text.includes('스즈무라 아이리, 스즈무라 아이리'))
})

test('buildJellyfinPersonOverview는 memo가 없으면 메모 섹션을 생략한다', () => {
  const text = buildJellyfinPersonOverview({
    name: 'A',
    agency: '',
    category: '',
    aliases: '',
    tags: '',
    memo: '',
  })
  assert.equal(text, '')
})

test('computeActorSyncHash는 같은 입력에서 같은 값을 반환한다', () => {
  const actor = { name: 'A', category: '배우', agency: 'X', aliases: 'AA', tags: 't1,t2', memo: 'memo' }
  const one = computeActorSyncHash(actor, 'img-hash')
  const two = computeActorSyncHash(actor, 'img-hash')
  assert.equal(one, two)
})

test('computeActorSyncHash는 memo 변경 시 달라진다', () => {
  const actorA = { name: 'A', category: '배우', agency: 'X', aliases: 'AA', tags: 't1,t2', memo: 'memo1' }
  const actorB = { ...actorA, memo: 'memo2' }
  assert.notEqual(computeActorSyncHash(actorA, 'img'), computeActorSyncHash(actorB, 'img'))
})

test('computeActorSyncHash는 agency 변경 시 달라진다', () => {
  const actorA = { name: 'A', category: '배우', agency: 'X', aliases: 'AA', tags: 't1,t2', memo: 'memo' }
  const actorB = { ...actorA, agency: 'Y' }
  assert.notEqual(computeActorSyncHash(actorA, 'img'), computeActorSyncHash(actorB, 'img'))
})

test('resolveActorImage는 지원 MIME 타입을 판정한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-image-'))
  const imagePath = path.join(dir, 'actor.jpg')
  fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xdb]))

  const result = await resolveActorImage({ image_path: imagePath })
  assert.equal(result.ok, true)
  assert.equal(result.contentType, 'image/jpeg')
})

test('resolveActorImage는 지원하지 않는 확장자를 거부한다', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'actor-image-'))
  const imagePath = path.join(dir, 'actor.gif')
  fs.writeFileSync(imagePath, Buffer.from([1, 2, 3]))

  const result = await resolveActorImage({ image_path: imagePath })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'UNSUPPORTED_IMAGE')
})

test('findPersonCandidates는 저장된 personId를 우선 사용한다', async () => {
  const api = {
    async getPersonById(id) { return { Id: id, Name: 'A' } },
    async searchPersonsByName() { return [] },
  }

  const result = await findPersonCandidates({ name: 'A', jellyfin_person_id: 'p-1', aliases: '' }, api)
  assert.equal(result.type, 'matched')
  assert.equal(result.method, 'saved_person_id')
  assert.equal(result.person.Id, 'p-1')
})

test('findPersonCandidates는 정확한 이름 1개만 자동 매칭한다', async () => {
  const api = {
    async getPersonById() { throw new Error('not-found') },
    async searchPersonsByName() { return [{ Id: 'p-1', Name: 'A' }] },
  }

  const result = await findPersonCandidates({ name: 'A', aliases: '' }, api)
  assert.equal(result.type, 'matched')
  assert.equal(result.method, 'exact_name')
})

test('findPersonCandidates는 정확한 이름이 여러 개면 needs_review를 반환한다', async () => {
  const api = {
    async getPersonById() { throw new Error('not-found') },
    async searchPersonsByName() { return [{ Id: 'p-1', Name: 'A' }, { Id: 'p-2', Name: 'A' }] },
  }

  const result = await findPersonCandidates({ name: 'A', aliases: '' }, api)
  assert.equal(result.type, 'needs_review')
})

test('findPersonCandidates는 aliases 정확 일치 1개를 후보로 제시한다', async () => {
  const api = {
    async getPersonById() { throw new Error('not-found') },
    async searchPersonsByName(name) {
      if (name === 'A') return []
      return [{ Id: 'p-1', Name: 'Alias A' }]
    },
  }

  const result = await findPersonCandidates({ name: 'A', aliases: 'Alias A' }, api)
  assert.equal(result.type, 'needs_review')
  assert.equal(result.method, 'alias_candidate')
})

test('findPersonCandidates는 부분 일치만으로 자동 매칭하지 않는다', async () => {
  const api = {
    async getPersonById() { throw new Error('not-found') },
    async searchPersonsByName() { return [{ Id: 'p-1', Name: 'A B' }] },
  }

  const result = await findPersonCandidates({ name: 'A', aliases: '' }, api)
  assert.notEqual(result.type, 'matched')
})

test('syncActor는 동일 hash면 skip 처리한다', async () => {
  const actor = {
    id: 1,
    name: 'A',
    category: '배우',
    agency: '',
    aliases: '',
    tags: '',
    memo: '',
    image_path: '',
    jellyfin_person_id: 'p-1',
    jellyfin_sync_status: 'synced',
    jellyfin_sync_hash: computeActorSyncHash({ name: 'A', category: '배우', agency: '', aliases: '', tags: '', memo: '' }, ''),
    jellyfin_synced_at: '',
    jellyfin_sync_error: '',
    jellyfin_matched_name: 'A',
    jellyfin_match_method: 'exact_name',
    jellyfin_image_synced_at: null,
  }

  const db = createMockDb(actor)
  const api = {
    async getPersonById() { return { Id: 'p-1', Name: 'A', Overview: '' } },
    async searchPersonsByName() { return [] },
    async updatePersonMetadata() { throw new Error('should not call') },
    async uploadPrimaryImage() { throw new Error('should not call') },
  }

  const result = await syncActor(db, api, actor, { force: false })
  assert.equal(result.success, true)
  assert.equal(result.skipped, true)
})

test('syncActor는 metadata 성공 + 이미지 없음일 때 image_missing 상태로 저장한다', async () => {
  const actor = {
    id: 2,
    name: 'B',
    category: '배우',
    agency: '',
    aliases: '',
    tags: '',
    memo: 'memo',
    image_path: '',
    jellyfin_person_id: '',
    jellyfin_sync_status: 'not_synced',
    jellyfin_sync_hash: '',
    jellyfin_synced_at: '',
    jellyfin_sync_error: '',
    jellyfin_matched_name: '',
    jellyfin_match_method: '',
    jellyfin_image_synced_at: null,
  }

  const db = createMockDb(actor)
  const api = {
    async getPersonById(id) { return { Id: id, Name: 'B', Overview: '' } },
    async searchPersonsByName() { return [{ Id: 'p-2', Name: 'B' }] },
    async updatePersonMetadata() { return { success: true } },
    async uploadPrimaryImage() { throw new Error('should not call') },
  }

  const result = await syncActor(db, api, actor, { force: false })
  assert.equal(result.success, true)
  assert.equal(result.status, SYNC_STATUS.IMAGE_MISSING)
  assert.equal(db.state.actor.jellyfin_person_id, 'p-2')
})

test('syncActor는 Person 미발견 시 not_found 상태를 저장한다', async () => {
  const actor = {
    id: 3,
    name: 'C',
    category: '배우',
    agency: '',
    aliases: '',
    tags: '',
    memo: '',
    image_path: '',
    jellyfin_person_id: '',
    jellyfin_sync_status: 'not_synced',
    jellyfin_sync_hash: '',
    jellyfin_synced_at: '',
    jellyfin_sync_error: '',
    jellyfin_matched_name: '',
    jellyfin_match_method: '',
    jellyfin_image_synced_at: null,
  }

  const db = createMockDb(actor)
  const api = {
    async getPersonById() { throw new Error('not-found') },
    async searchPersonsByName() { return [] },
    async updatePersonMetadata() { return { success: true } },
    async uploadPrimaryImage() { return { success: true } },
  }

  const result = await syncActor(db, api, actor, { force: false })
  assert.equal(result.success, false)
  assert.equal(result.status, SYNC_STATUS.NOT_FOUND)
})
