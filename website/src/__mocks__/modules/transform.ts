import { omit } from 'lodash';
import fs from 'node:fs';
import {
  Module,
  ClassNo,
  DayText,
  StartTime,
  EndTime,
  LessonType,
  Venue,
  Weeks,
  isWeekRange,
} from 'types/modules';

const transformFile = (file_path: string) =>
  fs.readFile(file_path, 'utf8', (_err, data) => {
    const module: Module = JSON.parse(data);
    const modifiedModule = {
      ...module,
      semesterData: module.semesterData.map((semesterData) => ({
        ...semesterData,
        timetable: semesterData.timetable.map((lesson) => {
          const lessonWithoutLessonIndex = omit(lesson, 'lessonIndex');
          const serializedLessonDetails = serializeLessonDetails(lessonWithoutLessonIndex);
          return {
            ...lessonWithoutLessonIndex,
            serializedLessonDetails,
          };
        }),
      })),
    };
    fs.writeFile(file_path, JSON.stringify(modifiedModule), () => {});
  });

fs.readdir('./', (_err, files) => {
  files.forEach((file) => {
    if (file.endsWith('.json')) {
      transformFile(file);
    }
  });
});

export type RawLesson = Readonly<{
  classNo: ClassNo;
  day: DayText;
  startTime: StartTime;
  endTime: EndTime;
  lessonType: LessonType;
  venue: Venue;
  weeks: Weeks;
}>;

type lessonTypeAbbrev = { [lessonType: string]: string };
export const LESSON_TYPE_ABBREV: lessonTypeAbbrev = {
  'Design Lecture': 'DLEC',
  Laboratory: 'LAB',
  Lecture: 'LEC',
  'Packaged Laboratory': 'PLAB',
  'Packaged Lecture': 'PLEC',
  'Packaged Tutorial': 'PTUT',
  Recitation: 'REC',
  'Sectional Teaching': 'SEC',
  'Seminar-Style Module Class': 'SEM',
  Tutorial: 'TUT',
  'Tutorial Type 2': 'TUT2',
  'Tutorial Type 3': 'TUT3',
  Workshop: 'WS',
};

type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
export const DAY_OF_WEEK_ABBREV: { [x in DayOfWeek]: string } = {
  Monday: 'MON',
  Tuesday: 'TUE',
  Wednesday: 'WED',
  Thursday: 'THU',
  Friday: 'FRI',
  Saturday: 'SAT',
  Sunday: 'SUN',
};

export function serializeLessonDetails<T extends RawLesson>(lesson: T): string {
  const { classNo, day, startTime, endTime, venue, weeks } = lesson;

  const abbreviatedDayOfWeek = DAY_OF_WEEK_ABBREV[day as DayOfWeek];
  const serializedWeeks = isWeekRange(weeks) ? JSON.stringify(weeks) : `(${weeks.join(',')})`;

  return [classNo, abbreviatedDayOfWeek, startTime, endTime, venue, serializedWeeks].join('|');
}

console.log(
  serializeLessonDetails({
    classNo: 'D1',
    startTime: '1200',
    endTime: '1400',
    weeks: [3, 5, 7, 9, 11, 13],
    venue: 'AS5-0309',
    day: 'Tuesday',
    lessonType: 'Tutorial',
    size: 26,
    covidZone: 'C',
  }),
);
