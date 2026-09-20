import assert from 'node:assert/strict';
import {
  EMPTY_PROFILE_STATE,
  isValidGender,
  normalizeCachedProfile
} from '../lib/userProfileCache.js';

function run() {
  assert.deepEqual(EMPTY_PROFILE_STATE, {
    name: '',
    year: null,
    month: null,
    day: null,
    hour: null,
    minute: null,
    gender: null
  });

  assert.equal(isValidGender(null), false);
  assert.equal(isValidGender(1), true);
  assert.equal(isValidGender(2), true);

  const empty = normalizeCachedProfile(null);
  assert.deepEqual(empty, EMPTY_PROFILE_STATE);

  const legacyTestDefault = normalizeCachedProfile({
    name: '',
    year: 1985,
    month: 10,
    day: 24,
    hour: 11,
    minute: 45,
    gender: 1
  });
  assert.equal(legacyTestDefault.year, 1985);
  assert.equal(legacyTestDefault.gender, 1);

  const profileA = normalizeCachedProfile({
    name: 'A',
    year: 1990,
    month: 5,
    day: 10,
    hour: 8,
    minute: 30,
    gender: 2
  });
  assert.equal(profileA.name, 'A');
  assert.equal(profileA.year, 1990);
  assert.equal(profileA.gender, 2);

  const invalid = normalizeCachedProfile({
    year: 1985,
    month: 13,
    day: 10,
    hour: 8,
    minute: 30,
    gender: 9
  });
  assert.equal(invalid.year, null);
  assert.equal(invalid.gender, null);

  console.log('testUserProfilePrivacy: ok');
}

run();
