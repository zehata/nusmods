import { each } from 'lodash-es';
import {
  deserializeLessonDetails,
  getClosestLessonConfig,
  getRecoveryClassNo,
  makeModuleLessonMap,
  parseWeeks,
  serializeLessonDetails,
  serializeWeekNumbers,
  serializeWeekRange,
} from './lessonId';
import { LessonId, ModuleLessonMap, RawLesson, WeekRange } from 'types/modules';
import { CS1010S } from '__mocks__/modules';
import { getModuleTimetable } from 'utils/modules';

const semester = 1;
const sampleModuleTimetable = getModuleTimetable(CS1010S, semester);

describe('serialize/parse weeks', () => {
  test('serialized weekRange should be deserialized to the same weekRange', () => {
    const weekRanges: WeekRange[] = [
      {
        start: '2026-01-13',
        end: '2026-02-14',
        weekInterval: 1,
      },
      {
        start: '2026-01-13',
        end: '2026-02-14',
        weeks: [2, 3, 5, 7, 11, 13],
      },
      {
        start: '2026-01-13',
        end: '2026-02-14',
        weekInterval: 1,
        weeks: [2, 3, 5, 7, 11, 13],
      },
    ];

    each(weekRanges, (weekRange) => {
      const deserializedWeekRange = parseWeeks(serializeWeekRange(weekRange));
      expect(deserializedWeekRange).toStrictEqual(weekRange);
    });
  });

  test('serialized week numbers should be deserialized to the same weekRange', () => {
    const weekNumbers = [2, 3, 5, 7, 11, 13];

    const deserializedWeekRange = parseWeeks(serializeWeekNumbers(weekNumbers));
    expect(deserializedWeekRange).toStrictEqual(weekNumbers);
  });
});

describe('makeModuleLessonMap', () => {
  test('should make lesson map from array of lessons', () => {
    const lectureLessons = [sampleModuleTimetable[0]];
    const recitationLessons = [sampleModuleTimetable[1], sampleModuleTimetable[2]];
    const tutorialLessons = [sampleModuleTimetable[11], sampleModuleTimetable[12]];

    const lessons: RawLesson[] = [...lectureLessons, ...recitationLessons, ...tutorialLessons];

    const expectedLessonMap: ModuleLessonMap<RawLesson> = {
      Lecture: {
        '1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13': sampleModuleTimetable[0],
      },
      Recitation: {
        '1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13': sampleModuleTimetable[1],
        '10|THU|1200|1300|RMI-SR1|1_2_3_4_5_6_7_8_9_10_11_12_13': sampleModuleTimetable[2],
      },
      Tutorial: {
        '1|MON|0900|1000|COM1-0203|3_4_5_6_7_8_9_10_11_12_13': sampleModuleTimetable[11],
        '10|TUE|0900|1000|COM1-0209|3_4_5_6_7_8_9_10_11_12_13': sampleModuleTimetable[12],
      },
    };

    expect(makeModuleLessonMap(lessons)).toStrictEqual(expectedLessonMap);
  });
});

describe('serialize/deserialize lesson details', () => {
  const lessons: RawLesson[] = [
    sampleModuleTimetable[0],
    // TODO: Add ADS5203 as a mock module
    {
      classNo: 'N1',
      endTime: '1700',
      startTime: '1400',
      weeks: {
        end: '2026-06-18',
        start: '2026-05-21',
        weekInterval: 2,
      },
      day: 'Thursday',
      lessonType: 'Sectional Teaching',
      venue: '',
    },
  ];

  test('serialized lessons should be deserialized to the same lesson', () => {
    each(lessons, async (lesson) => {
      const deserializedLesson = await deserializeLessonDetails(serializeLessonDetails(lesson));
      const deserializedLessonWithLessonType = {
        ...deserializedLesson,
        lessonType: lesson.lessonType,
      };
      expect(deserializedLessonWithLessonType).toStrictEqual(lesson);
    });
  });

  test('deserializing empty or malformed lessonId should throw error', () => {
    const lessonIds: LessonId[] = [
      '',
      'ABC123',
      '2026-01-13_',
      'N1|THU|1400|1700|',
      undefined as unknown as LessonId,
    ];

    each(lessonIds, (lessonId) => {
      expect(deserializeLessonDetails(lessonId)).rejects.toMatch('Lesson ID is malformed');
    });
  });

  test('deserializing empty or malformed lessonId should throw error', () => {
    const lessonIds: LessonId[] = ['N1|THU|1400|1700||abc', 'N1|THU|1400|1700||a-b-c'];

    each(lessonIds, (lessonId) => {
      expect(deserializeLessonDetails(lessonId)).rejects.toMatch('Serialized weeks is malformed');
    });
  });
});

describe(getClosestLessonConfig, () => {
  test('ignore if lesson type has no classNo', () => {
    expect(
      getClosestLessonConfig(
        { Lecture: {} },
        { Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'] },
      ),
    ).toEqual({});
  });
});

describe(getRecoveryClassNo, () => {
  test('guard against empty lessons input', () => {
    expect(getRecoveryClassNo({})).toEqual([]);
  });
});
