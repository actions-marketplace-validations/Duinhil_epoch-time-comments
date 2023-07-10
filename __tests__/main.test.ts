import * as process from 'process'
import * as cp from 'child_process'
import * as path from 'path'
import {expect, test} from '@jest/globals'
import {ReplaceEpochTimes} from '../src/util'

// shows how the runner will run a javascript action with env / stdout protocol
test('test ReplaceEpochTimes', () => {
  expect(ReplaceEpochTimes('Test string 123 789', 500, 256)).toBe(
    'Test string 123 Thu, 01 Jan 1970 00:13:09 GMT'
  )
  expect(ReplaceEpochTimes('Test string 123 789', 500, 0)).toBe(
    'Test string 123 789'
  )
})
