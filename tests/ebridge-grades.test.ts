import { it } from 'node:test'
import assert from 'node:assert/strict'
import { ebridgeGradeInspection, parseEbridgeGrades, selectGradeLinks } from '../src/providers/ebridge-grades.ts'

const module = { code: 'DEMO101', title: 'Synthetic module', year: '2026/27', period: 'SEM1', credits: '5', moduleType: 'Compulsory', mark: '0', grade: 'F', attempt: '1', components: [{ title: 'Example exam', type: 'Exam', weight: '60', mark: '0' }, { title: 'Example work', type: 'Coursework', weight: '40', mark: null }] }
const document = (modules: unknown[]) => ({ recognized: true, valid: true, auth: false, modules })

it('grade navigation selects the observed read-only entries and excludes assessment applications', () => {
  const links = [{ text: 'Academic Records', href: 'https://ebridge.xjtlu.edu.cn/overview' }, { text: 'Full Academic Records', href: 'https://ebridge.xjtlu.edu.cn/records' }, { text: 'Component Marks (2026/27)', href: 'https://ebridge.xjtlu.edu.cn/components' }, { text: 'CW/Academic Unit Scheduled Assessment MC Application', href: 'https://ebridge.xjtlu.edu.cn/application' }]
  const result = selectGradeLinks([...links, links[2]])
  assert.equal(result.overview, links[0]); assert.equal(result.records, links[1])
  assert.deepEqual(result.components, [links[2]])
})

it('grades preserve published zero, missing marks, weights, grades and separate attempts', () => {
  const result = parseEbridgeGrades(document([module, { ...module, attempt: '2', mark: '64.5', grade: 'P' }]), 'records')!
  assert.equal(result[0].mark, '0'); assert.equal(result[0].grade, 'F')
  assert.deepEqual(result[0].components.map(row => row.mark), ['0', null])
  assert.equal(result[0].components[0].weight, '60')
  assert.equal(result[1].mark, '64.5'); assert.equal(result[1].attempt, '2')
  assert.notEqual(result[0].id, result[1].id)
})

it('grades distinguish an empty report from expired, changed, partial or invalid data', () => {
  assert.deepEqual(parseEbridgeGrades(document([]), 'components'), [])
  assert.equal(parseEbridgeGrades({ ...document([]), recognized: false }, 'components'), null)
  assert.equal(parseEbridgeGrades({ ...document([module]), valid: false }, 'records'), null)
  assert.equal(parseEbridgeGrades({ ...document([module]), auth: true }, 'records'), null)
  assert.equal(parseEbridgeGrades(document([{ ...module, code: '' }]), 'records'), null)
  assert.equal(parseEbridgeGrades({ modules: [] }, 'records'), null)
})

it('grades keep only projected fields and do not forward links or school session parameters', () => {
  const result = parseEbridgeGrades(document([{ ...module, title: 'Example https://ebridge.xjtlu.edu.cn/?session=PRIVATE', privateUrl: 'PRIVATE', components: module.components.map(row => ({ ...row, privateUrl: 'PRIVATE' })) }]), 'records')!
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|privateUrl|https:/)
})

it('the two grade inspection scripts are valid JavaScript with a validated academic-year argument', () => {
  assert.doesNotThrow(() => new Function(ebridgeGradeInspection('components', '2026/27')))
  assert.doesNotThrow(() => new Function(ebridgeGradeInspection('records')))
  assert.doesNotMatch(ebridgeGradeInspection('components', 'private-session'), /private-session/)
})
