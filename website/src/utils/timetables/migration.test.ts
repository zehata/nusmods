import { getModuleLessonMap, getModuleTimetable } from 'utils/modules';

import { CS1010S } from '__mocks__/modules';
import { migrateModuleLessonConfig } from './migration';

describe('v1 config migration', () => {
  const moduleLessonConfig = {
    Lecture: '1',
  };
  const moduleTimetable = getModuleTimetable(CS1010S, 1);
  const lessonMap = getModuleLessonMap(CS1010S, 1);
  test('should do nothing if already migrated', () => {
    const migrationResult = migrateModuleLessonConfig(
      {
        Lecture: ['1'],
      },
      [],
      'CS1010S',
      moduleTimetable,
      lessonMap,
      false,
    );
    expect(migrationResult).toEqual({
      migratedModuleLessonConfig: {
        Lecture: ['1'],
      },
      alreadyMigrated: true,
    });
  });

  test('should not error if ta module config was migrated but module lesson config was not', () => {
    const migrationResult = migrateModuleLessonConfig(
      moduleLessonConfig,
      [],
      'CS1010S',
      moduleTimetable,
      lessonMap,
      false,
    );
    expect(migrationResult).toEqual({
      migratedModuleLessonConfig: {
        Lecture: ['1'],
      },
      alreadyMigrated: false,
    });
  });
});
