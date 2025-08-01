import {
  ClassNo,
  LessonGroup,
  LessonIndex,
  LessonType,
  ModuleCode,
  ModuleTitle,
  RawLesson,
  Semester,
} from './modules';

export type ModuleLessonConfig = {
  [lessonType: LessonType]: LessonIndex[];
};

//  ModuleLessonConfig is a mapping of lessonType to ClassNo for a module.
export type ClassNoModuleLessonConfig = {
  [lessonType: LessonType]: ClassNo;
};

export type SemTimetableConfig = {
  [moduleCode: ModuleCode]: ModuleLessonConfig;
};

// SemTimetableConfig is the timetable data for each semester.
export type ClassNoSemTimetableConfig = {
  [moduleCode: ModuleCode]: ClassNoModuleLessonConfig;
};

export type TaModulesConfig = ModuleCode[];

// TaModulesConfig is a mapping of moduleCode to the TA's lesson types.
export type ClassNoTaModulesConfig = {
  [moduleCode: ModuleCode]: [lessonType: LessonType, classNo: ClassNo][];
};

//  ModuleLessonConfigWithLessons is a mapping of lessonType to an array of Lessons for a module.
export type Lesson = RawLesson & {
  moduleCode: ModuleCode;
  title: ModuleTitle;
};

export type ColoredLesson = Lesson & {
  colorIndex: ColorIndex;
  isTaInTimetable?: boolean;
  isModifiable?: boolean;
  isAvailable?: boolean;
  isActive?: boolean;
  isOptionInTimetable?: boolean;
  lessonGroup?: string;
};

//  The array of Lessons must belong to that lessonType.
export type ModuleLessonConfigWithLessons = {
  [lessonType: LessonType]: RawLesson[];
};

// SemTimetableConfig is the timetable data for each semester with lessons data.
export type SemTimetableConfigWithLessons = {
  [moduleCode: ModuleCode]: ModuleLessonConfigWithLessons;
};

// TimetableConfig is the timetable data for the whole academic year.
export type ClassNoTimetableConfig = {
  [semester: Semester]: ClassNoSemTimetableConfig;
};

// TimetableConfig is the timetable data for the whole academic year.
export type TimetableConfig = {
  [semester: Semester]: SemTimetableConfig;
};

// TimetableDayFormat is timetable data grouped by DayText.
export type TimetableDayFormat = {
  [dayText: string]: ColoredLesson[];
};

// TimetableDayArrangement is the arrangement of lessons on the timetable within a day.
export type TimetableDayArrangement = ColoredLesson[][];

// TimetableArrangement is the arrangement of lessons on the timetable for a week.
export type TimetableArrangement = {
  [dayText: string]: TimetableDayArrangement;
};

// Represents the lesson which the user is currently hovering over.
// Used to highlight lessons which have the same classNo
export type HoverLesson = {
  readonly moduleCode: ModuleCode;
  readonly lessonType: LessonType;
  readonly lessonIndex: LessonIndex;
  readonly lessonGroup?: LessonGroup;
};

export type ColorIndex = number;

export interface DeserializationResult {
  semTimetableConfig: SemTimetableConfig;
  ta: ModuleCode[];
  hidden: ModuleCode[];
}
