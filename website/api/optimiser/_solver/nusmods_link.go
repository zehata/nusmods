package solver

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"

	constants "github.com/nusmodifications/nusmods/website/api/optimiser/_constants"
	models "github.com/nusmodifications/nusmods/website/api/optimiser/_models"
)

// GenerateNUSModsShareableLink creates a shareable NUSMods link from the assignments
func GenerateNUSModsShareableLink(
	assignments map[string]string,
	defaultSlots map[string]map[string][]models.ModuleSlot,
	lessonToSlots map[string][][]models.ModuleSlot,
	req models.OptimiserRequest,
) (string, string) {
	config := createConfig(assignments, lessonToSlots)
	serializedConfig := serializeConfig(config)

	// Initialize assignments for skipped slots with default slots
	for moduleCode, lessonTypeMap := range defaultSlots {
		for lessonType, slots := range lessonTypeMap {
			lessonKey := strings.ToUpper(moduleCode) + "|" + lessonType
			if assignments[lessonKey] == "" {
				classNo := slots[0].ClassNo
				assignments[lessonKey] = classNo
				lessonToSlots[lessonKey] = append(lessonToSlots[lessonKey], slots)
			}
		}
	}

	defaultConfig := createConfig(assignments, lessonToSlots)
	defaultSerializedConfig := serializeConfig(defaultConfig)

	semesterPath := ""
	switch req.AcadSem {
	case 1:
		semesterPath = "sem-1"
	case 2:
		semesterPath = "sem-2"
	case 3:
		semesterPath = "st-i"
	case 4:
		semesterPath = "st-ii"
	default:
		semesterPath = "sem-1"
	}

	// Construct final URL
	shareableURL := fmt.Sprintf("%s/%s/share?%s", constants.NUSModsTimetableBaseURL, semesterPath, serializedConfig)
	defaultShareableURL := fmt.Sprintf(
		"%s/%s/share?%s",
		constants.NUSModsTimetableBaseURL,
		semesterPath,
		defaultSerializedConfig,
	)

	return shareableURL, defaultShareableURL
}

func serializeWeekNumbers(weeks []int) string {
	weeksStrings := make([]string, 0, len(weeks))
	for _, week := range weeks {
		weeksStrings = append(weeksStrings, strconv.Itoa(week))
	}
	return strings.Join(weeksStrings, constants.WeeksSeparator)
}

func serializeWeekRange(weekRange models.WeekRange) string {
	serializedStartEndInterval := strings.Join([]string{weekRange.Start, weekRange.End, strconv.Itoa(weekRange.WeekInterval)}, constants.WeeksSeparator)

	weeks := weekRange.Weeks
	if weeks == nil {
		return serializedStartEndInterval
	}

	return serializedStartEndInterval + "_" + serializeWeekNumbers(weeks)
}

func serializeModuleSlot(
	slot models.ModuleSlot,
) models.SerializedDetails {
	abbreviatedDayOfWeek := constants.DayOfWeekAbbrev[slot.DayIndex]

	serializedWeeks := ""
	var weekRange models.WeekRange
	err := json.Unmarshal(slot.Weeks, &weekRange)
	if err == nil {
		serializedWeeks = serializeWeekRange(weekRange)
	} else {
		weeksArray := new(models.WeeksArray)
		json.Unmarshal(slot.Weeks, &weeksArray)
	}

	lessonDetails := []string{slot.ClassNo, abbreviatedDayOfWeek, slot.StartTime, slot.EndTime, slot.Venue, serializedWeeks}
	return strings.Join(lessonDetails, constants.LessonDetailSeparator)
}

// Parses the assignments into a map of module codes to lesson types to class numbers
func createConfig(
	assignments map[string]string,
	lessonToSlots map[string][][]models.ModuleSlot,
) map[string]map[string][]models.SerializedDetails {
	config := make(map[string]map[string][]models.SerializedDetails)

	for lessonKey, classNo := range assignments {
		// Parse lesson key: "MODULE|LESSONTYPE"
		parts := strings.Split(lessonKey, "|")
		if len(parts) != 2 {
			continue
		}
		moduleCode := parts[0]
		lessonType := parts[1]

		// Initialize module config if not exists
		if config[moduleCode] == nil {
			config[moduleCode] = make(map[string][]models.SerializedDetails)
		}

		// Add lesson type and class number to config
		for _, lessonsWithClassNo := range lessonToSlots[lessonKey] {
			if lessonsWithClassNo[0].ClassNo != classNo {
				continue
			}

			for _, lesson := range lessonsWithClassNo {
				config[moduleCode][lessonType] = append(config[moduleCode][lessonType], serializeModuleSlot(lesson))
			}
			break
		}
	}

	return config
}

// Constructs the URL
func serializeConfig(config map[string]map[string][]models.SerializedDetails) string {
	var moduleParams []string

	for moduleCode, lessons := range config {
		var lessonParams []string
		for lessonType, serializedDetails := range lessons {
			// Get abbreviation for lesson type
			abbrev := constants.LessonTypeAbbrev[strings.ToUpper(lessonType)]

			lessonParams = append(
				lessonParams,
				fmt.Sprintf("%s:%s", abbrev, "("+strings.Join(serializedDetails, ",")+")"),
			)
		}
		if len(lessonParams) > 0 {
			moduleParams = append(
				moduleParams,
				fmt.Sprintf("%s=%s", moduleCode, strings.Join(lessonParams, constants.ModuleCodeSeparator)),
			)
		}
	}

	return strings.Join(moduleParams, "&")
}
