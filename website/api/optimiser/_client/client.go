package client

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/nusmodifications/nusmods/website/api/optimiser/_constants"
	"github.com/nusmodifications/nusmods/website/api/optimiser/_models"
)

func GetVenues() (map[string]models.Location, error) {
	venues := make(map[string]models.Location)
	// url := constants.VenuesURL
	res, err := os.Open("../../../src/data/venues.json")
	if err != nil {
		return nil, err
	}
	defer res.Close()

	body, err := io.ReadAll(res)
	if err != nil {
		return nil, err
	}
	err = json.Unmarshal(body, &venues)
	if err != nil {
		return nil, err
	}

	return venues, nil
}

func GetModuleData(acadYear string, module string) ([]byte, error) {
	url := fmt.Sprintf(constants.ModulesURL, acadYear, module)
	res, err := http.Get(url)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()

	body, err := io.ReadAll(res.Body)
	if err != nil {
		return nil, err
	}
	return body, nil
}
