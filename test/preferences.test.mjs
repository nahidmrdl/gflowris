import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {DEFAULT_PREFERENCES,validatePreferences} from '../src/preferences.mjs';

test('workspace preferences preserve drafts, merge defaults, and reject invalid settings',()=>{
  const initial={outputFolder:os.tmpdir(),...structuredClone(DEFAULT_PREFERENCES)};
  const updated=validatePreferences({defaults:{count:4,removeBackground:true},draft:'[{"prompt":"A crystal"}]'},initial);
  assert.equal(updated.defaults.count,4);assert.equal(updated.defaults.resolution,'2K');
  assert.equal(initial.defaults.count,1);assert.equal(updated.draft,'[{"prompt":"A crystal"}]');
  assert.equal(validatePreferences({outputFolder:os.tmpdir()},updated).outputFolder,path.resolve(os.tmpdir()));
  for(const update of [{outputFolder:'relative'},{defaults:{count:5}},{defaults:{autoCrop:'false'}},{defaults:{quality:'detail'}},{defaults:null},{draft:[]},{unknown:true}])assert.throws(()=>validatePreferences(update,initial));
});
