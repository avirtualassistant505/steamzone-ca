export const estimateFormSchema = {
  "version": "v1",
  "title": "Steam Zone Estimate Form Schema",
  "services": [
    {
      "key": "window",
      "label": "Residential Window Cleaning",
      "steps": [
        "Property",
        "Home Size",
        "Scope",
        "Complexity",
        "Contact"
      ]
    },
    {
      "key": "commercialWindow",
      "label": "Commercial Window Cleaning",
      "steps": [
        "Property",
        "Glass Size",
        "Frequency",
        "Access",
        "Contact"
      ]
    },
    {
      "key": "carpet",
      "label": "Carpet Cleaning",
      "steps": [
        "Area Type",
        "Quantity",
        "Condition",
        "Add-ons",
        "Contact"
      ]
    },
    {
      "key": "postConstruction",
      "label": "Post-Construction Cleaning",
      "steps": [
        "Project Type",
        "Size",
        "Stage",
        "Add-ons",
        "Contact"
      ]
    }
  ],
  "fields": [
    {
      "key": "serviceType",
      "label": "Service Type",
      "type": "select",
      "required": true,
      "step": 0,
      "appliesTo": [
        "window",
        "commercialWindow",
        "carpet",
        "postConstruction"
      ],
      "options": [
        {
          "value": "window",
          "label": "Residential Windows"
        },
        {
          "value": "commercialWindow",
          "label": "Commercial Windows"
        },
        {
          "value": "carpet",
          "label": "Carpet Cleaning"
        },
        {
          "value": "postConstruction",
          "label": "Post-Construction"
        }
      ],
      "validation": {
        "enum": [
          "window",
          "commercialWindow",
          "carpet",
          "postConstruction"
        ]
      },
      "helpText": "Choose the service you want estimated.",
      "examples": [
        "residential windows",
        "commercial windows",
        "carpet",
        "post-construction"
      ]
    },
    {
      "key": "postalCode",
      "label": "Postal Code",
      "type": "postalCode",
      "required": true,
      "step": 1,
      "appliesTo": [
        "window",
        "commercialWindow",
        "carpet",
        "postConstruction"
      ],
      "validation": {
        "regex": "^[A-Za-z]\\d[A-Za-z]\\s?\\d[A-Za-z]\\d$",
        "country": "CA"
      },
      "helpText": "Enter a Canadian postal code (example: R5G 2X3).",
      "examples": [
        "R5G 2X3",
        "R2M1A1"
      ]
    },
    {
      "key": "zone",
      "label": "Travel Zone",
      "type": "select",
      "required": true,
      "step": 1,
      "appliesTo": [
        "window",
        "commercialWindow",
        "carpet",
        "postConstruction"
      ],
      "options": [
        {
          "value": "zoneA",
          "label": "Zone A - Steinbach + 15km"
        },
        {
          "value": "zoneB",
          "label": "Zone B - 15km to 35km"
        },
        {
          "value": "zoneC",
          "label": "Zone C - Winnipeg trips"
        },
        {
          "value": "zoneD",
          "label": "Zone D - Extended rural"
        }
      ],
      "validation": {
        "enum": [
          "zoneA",
          "zoneB",
          "zoneC",
          "zoneD"
        ]
      },
      "helpText": "Travel zone can be auto-detected from postal code, then adjusted if needed.",
      "examples": [
        "zoneA"
      ]
    },
    {
      "key": "storey",
      "label": "House Type / Storeys",
      "type": "select",
      "required": true,
      "step": 1,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "options": [
        {
          "value": "bungalow",
          "label": "Bungalow"
        },
        {
          "value": "oneHalf",
          "label": "1.5 storey"
        },
        {
          "value": "two",
          "label": "2 storey"
        },
        {
          "value": "twoHalf",
          "label": "2.5 storey"
        },
        {
          "value": "three",
          "label": "3 storey"
        }
      ],
      "validation": {
        "enum": [
          "bungalow",
          "oneHalf",
          "two",
          "twoHalf",
          "three"
        ]
      },
      "helpText": "Select the closest home storey profile.",
      "examples": [
        "2 storey",
        "bungalow"
      ]
    },
    {
      "key": "sizeBracket",
      "label": "Square Footage Bracket",
      "type": "select",
      "required": true,
      "step": 2,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "options": [
        {
          "value": "under1000",
          "label": "Under 1000 sq ft"
        },
        {
          "value": "1000to1500",
          "label": "1000 - 1500 sq ft"
        },
        {
          "value": "1500to2000",
          "label": "1500 - 2000 sq ft"
        },
        {
          "value": "2000to2500",
          "label": "2000 - 2500 sq ft"
        },
        {
          "value": "2500to3000",
          "label": "2500 - 3000 sq ft"
        },
        {
          "value": "over3000",
          "label": "3000+ sq ft"
        }
      ],
      "validation": {
        "enum": [
          "under1000",
          "1000to1500",
          "1500to2000",
          "2000to2500",
          "2500to3000",
          "over3000"
        ]
      },
      "helpText": "Use the best size bracket when exact square footage is unknown.",
      "examples": [
        "1500to2000"
      ]
    },
    {
      "key": "scope",
      "label": "Cleaning Scope",
      "type": "select",
      "required": true,
      "step": 3,
      "appliesTo": [
        "window",
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "in": [
              "window",
              "commercialWindow"
            ]
          }
        ]
      },
      "optionsByService": {
        "window": [
          {
            "value": "exterior",
            "label": "Exterior only"
          },
          {
            "value": "interior",
            "label": "Interior only"
          },
          {
            "value": "both",
            "label": "Interior + Exterior"
          }
        ],
        "commercialWindow": [
          {
            "value": "exterior",
            "label": "Exterior only"
          },
          {
            "value": "both",
            "label": "Interior + exterior"
          }
        ]
      },
      "validation": {
        "byServiceEnum": {
          "window": [
            "exterior",
            "interior",
            "both"
          ],
          "commercialWindow": [
            "exterior",
            "both"
          ]
        }
      },
      "helpText": "Choose which glass sides are included.",
      "examples": [
        "both"
      ]
    },
    {
      "key": "screens",
      "label": "Screens",
      "type": "select",
      "required": true,
      "step": 3,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "options": [
        {
          "value": "none",
          "label": "None"
        },
        {
          "value": "some",
          "label": "Some"
        },
        {
          "value": "all",
          "label": "All"
        }
      ],
      "validation": {
        "enum": [
          "none",
          "some",
          "all"
        ]
      },
      "helpText": "Choose none, some, or all screens.",
      "examples": [
        "some"
      ]
    },
    {
      "key": "tracks",
      "label": "Tracks & Sills",
      "type": "select",
      "required": true,
      "step": 3,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "options": [
        {
          "value": "basic",
          "label": "Basic"
        },
        {
          "value": "detailed",
          "label": "Detailed"
        }
      ],
      "validation": {
        "enum": [
          "basic",
          "detailed"
        ]
      },
      "helpText": "Detailed includes deeper track/sill cleaning.",
      "examples": [
        "detailed"
      ]
    },
    {
      "key": "hardToReach",
      "label": "Hard-to-reach windows",
      "type": "boolean",
      "required": true,
      "step": 3,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "helpText": "Include difficult access windows.",
      "examples": [
        "yes",
        "no"
      ]
    },
    {
      "key": "hardWaterRemoval",
      "label": "Hard water removal needed",
      "type": "boolean",
      "required": true,
      "step": 3,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "helpText": "Hard water stain removal may require confirmation.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "constructionDebris",
      "label": "Construction debris / paint on glass",
      "type": "boolean",
      "required": true,
      "step": 3,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "helpText": "Includes overspray, paint, or post-construction residue.",
      "examples": [
        "no"
      ]
    },
    {
      "key": "slidingRemoval",
      "label": "Sliding windows removal",
      "type": "select",
      "required": true,
      "step": 4,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "options": [
        {
          "value": "none",
          "label": "No"
        },
        {
          "value": "threePanel",
          "label": "3-panel"
        },
        {
          "value": "fivePanel",
          "label": "5-panel"
        }
      ],
      "validation": {
        "enum": [
          "none",
          "threePanel",
          "fivePanel"
        ]
      },
      "helpText": "Choose the sliding removal type if needed.",
      "examples": [
        "none",
        "threePanel"
      ]
    },
    {
      "key": "slidingQuantity",
      "label": "Sliding quantity",
      "type": "integer",
      "required": true,
      "step": 4,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          },
          {
            "key": "slidingRemoval",
            "notEquals": "none"
          }
        ]
      },
      "validation": {
        "min": 1,
        "max": 50
      },
      "helpText": "Required when sliding removal is selected.",
      "examples": [
        "1",
        "2"
      ]
    },
    {
      "key": "patioDoors",
      "label": "Patio doors",
      "type": "select",
      "required": true,
      "step": 4,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "options": [
        {
          "value": "none",
          "label": "No patio work"
        },
        {
          "value": "takeApart",
          "label": "Take-apart"
        },
        {
          "value": "slideOnly",
          "label": "Slide-only"
        }
      ],
      "validation": {
        "enum": [
          "none",
          "takeApart",
          "slideOnly"
        ]
      },
      "helpText": "Select patio door handling option.",
      "examples": [
        "slideOnly"
      ]
    },
    {
      "key": "patioQuantity",
      "label": "Patio quantity",
      "type": "integer",
      "required": true,
      "step": 4,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          },
          {
            "key": "patioDoors",
            "notEquals": "none"
          }
        ]
      },
      "validation": {
        "min": 1,
        "max": 50
      },
      "helpText": "Required when patio option is selected.",
      "examples": [
        "1"
      ]
    },
    {
      "key": "skylights",
      "label": "Skylights",
      "type": "select",
      "required": true,
      "step": 4,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "options": [
        {
          "value": "none",
          "label": "None"
        },
        {
          "value": "interior",
          "label": "Interior only"
        },
        {
          "value": "exterior",
          "label": "Exterior only"
        },
        {
          "value": "both",
          "label": "Both sides"
        }
      ],
      "validation": {
        "enum": [
          "none",
          "interior",
          "exterior",
          "both"
        ]
      },
      "helpText": "Select skylight side scope.",
      "examples": [
        "both"
      ]
    },
    {
      "key": "skylightQuantity",
      "label": "Skylight quantity",
      "type": "integer",
      "required": true,
      "step": 4,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          },
          {
            "key": "skylights",
            "notEquals": "none"
          }
        ]
      },
      "validation": {
        "min": 1,
        "max": 50
      },
      "helpText": "Required when skylights are included.",
      "examples": [
        "1"
      ]
    },
    {
      "key": "railingGlass",
      "label": "Railing glass",
      "type": "select",
      "required": true,
      "step": 4,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "options": [
        {
          "value": "none",
          "label": "None"
        },
        {
          "value": "oneSide",
          "label": "1 side"
        },
        {
          "value": "twoSides",
          "label": "2 sides"
        }
      ],
      "validation": {
        "enum": [
          "none",
          "oneSide",
          "twoSides"
        ]
      },
      "helpText": "Select railing glass side count.",
      "examples": [
        "oneSide"
      ]
    },
    {
      "key": "frenchPanes",
      "label": "French panes",
      "type": "select",
      "required": true,
      "step": 4,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "options": [
        {
          "value": "none",
          "label": "None"
        },
        {
          "value": "some",
          "label": "Some"
        },
        {
          "value": "lots",
          "label": "Lots"
        }
      ],
      "validation": {
        "enum": [
          "none",
          "some",
          "lots"
        ]
      },
      "helpText": "Choose the French pane amount.",
      "examples": [
        "some"
      ]
    },
    {
      "key": "sunroom",
      "label": "Sunroom",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "helpText": "Include sunroom area cleaning.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "walkoutBasement",
      "label": "Walkout basement access",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "window"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "window"
          }
        ]
      },
      "helpText": "Indicate walkout basement access requirements.",
      "examples": [
        "no"
      ]
    },
    {
      "key": "buildingType",
      "label": "Building type",
      "type": "select",
      "required": true,
      "step": 1,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          }
        ]
      },
      "options": [
        {
          "value": "storefront",
          "label": "Storefront"
        },
        {
          "value": "lowRise",
          "label": "Low-rise"
        },
        {
          "value": "midRise",
          "label": "Mid-rise"
        },
        {
          "value": "highRise",
          "label": "High-rise"
        }
      ],
      "validation": {
        "enum": [
          "storefront",
          "lowRise",
          "midRise",
          "highRise"
        ]
      },
      "helpText": "Classify building type.",
      "examples": [
        "storefront"
      ]
    },
    {
      "key": "storeys",
      "label": "Storeys",
      "type": "select",
      "required": true,
      "step": 1,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          }
        ]
      },
      "options": [
        {
          "value": "ground",
          "label": "Ground-floor"
        },
        {
          "value": "twoToThree",
          "label": "2-3 storeys"
        },
        {
          "value": "fourToEight",
          "label": "4-8 storeys"
        },
        {
          "value": "ninePlus",
          "label": "9+ storeys"
        }
      ],
      "validation": {
        "enum": [
          "ground",
          "twoToThree",
          "fourToEight",
          "ninePlus"
        ]
      },
      "helpText": "Specify storey band.",
      "examples": [
        "ground"
      ]
    },
    {
      "key": "sizeMode",
      "label": "Glass size method",
      "type": "select",
      "required": true,
      "step": 2,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          }
        ]
      },
      "options": [
        {
          "value": "paneCount",
          "label": "Pane count"
        },
        {
          "value": "frontage",
          "label": "Frontage length"
        }
      ],
      "validation": {
        "enum": [
          "paneCount",
          "frontage"
        ]
      },
      "helpText": "Choose either pane count or frontage estimate.",
      "examples": [
        "paneCount"
      ]
    },
    {
      "key": "paneCount",
      "label": "Pane count",
      "type": "integer",
      "required": true,
      "step": 2,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          },
          {
            "key": "sizeMode",
            "equals": "paneCount"
          }
        ]
      },
      "validation": {
        "min": 1,
        "max": 10000
      },
      "helpText": "Required if size mode is pane count.",
      "examples": [
        "24"
      ]
    },
    {
      "key": "frontageFeet",
      "label": "Frontage (feet)",
      "type": "integer",
      "required": true,
      "step": 2,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          },
          {
            "key": "sizeMode",
            "equals": "frontage"
          }
        ]
      },
      "validation": {
        "min": 1,
        "max": 100000
      },
      "helpText": "Required if size mode is frontage.",
      "examples": [
        "45 ft",
        "30"
      ]
    },
    {
      "key": "glassDoors",
      "label": "Glass door count",
      "type": "integer",
      "required": true,
      "step": 2,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          }
        ]
      },
      "validation": {
        "min": 0,
        "max": 1000
      },
      "helpText": "Count storefront or entry glass doors.",
      "examples": [
        "2"
      ]
    },
    {
      "key": "frequency",
      "label": "Service frequency",
      "type": "select",
      "required": true,
      "step": 3,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          }
        ]
      },
      "options": [
        {
          "value": "oneTime",
          "label": "One-time"
        },
        {
          "value": "monthly",
          "label": "Monthly"
        },
        {
          "value": "biweekly",
          "label": "Biweekly"
        },
        {
          "value": "weekly",
          "label": "Weekly"
        }
      ],
      "validation": {
        "enum": [
          "oneTime",
          "monthly",
          "biweekly",
          "weekly"
        ]
      },
      "helpText": "Recurring frequencies apply discounts.",
      "examples": [
        "monthly"
      ]
    },
    {
      "key": "liftRequired",
      "label": "Lift/boom access required",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          }
        ]
      },
      "helpText": "Indicate if lift access is needed.",
      "examples": [
        "no"
      ]
    },
    {
      "key": "afterHours",
      "label": "After-hours cleaning required",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          }
        ]
      },
      "helpText": "After-hours service adds premium.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "overspray",
      "label": "Sticker/paint/overspray present",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          }
        ]
      },
      "helpText": "May require photo/site confirmation.",
      "examples": [
        "no"
      ]
    },
    {
      "key": "hardWater",
      "label": "Hard water stain treatment needed",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "commercialWindow"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "commercialWindow"
          }
        ]
      },
      "helpText": "Hard water treatment is per-pane add-on.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "estimateMode",
      "label": "Estimate method",
      "type": "select",
      "required": true,
      "step": 1,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          }
        ]
      },
      "options": [
        {
          "value": "rooms",
          "label": "By rooms"
        },
        {
          "value": "sqft",
          "label": "By square footage"
        }
      ],
      "validation": {
        "enum": [
          "rooms",
          "sqft"
        ]
      },
      "helpText": "Choose room-count or sqft bracket method.",
      "examples": [
        "rooms"
      ]
    },
    {
      "key": "rooms",
      "label": "Room count",
      "type": "integer",
      "required": true,
      "step": 2,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          },
          {
            "key": "estimateMode",
            "equals": "rooms"
          }
        ]
      },
      "validation": {
        "min": 2,
        "max": 50
      },
      "helpText": "Required when estimate method is rooms.",
      "examples": [
        "3",
        "3 bedrooms"
      ]
    },
    {
      "key": "sqftBracket",
      "label": "Square footage bracket",
      "type": "select",
      "required": true,
      "step": 2,
      "appliesTo": [
        "carpet",
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "in": [
              "carpet",
              "postConstruction"
            ]
          }
        ],
        "any": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          },
          {
            "key": "estimateMode",
            "equals": "sqft"
          }
        ]
      },
      "optionsByService": {
        "carpet": [
          {
            "value": "under500",
            "label": "Under 500 sq ft"
          },
          {
            "value": "500to1000",
            "label": "500 - 1000 sq ft"
          },
          {
            "value": "1000to1500",
            "label": "1000 - 1500 sq ft"
          },
          {
            "value": "1500to2000",
            "label": "1500 - 2000 sq ft"
          },
          {
            "value": "over2000",
            "label": "2000+ sq ft"
          }
        ],
        "postConstruction": [
          {
            "value": "under1000",
            "label": "Under 1000 sq ft"
          },
          {
            "value": "1000to2500",
            "label": "1000 - 2500 sq ft"
          },
          {
            "value": "2500to5000",
            "label": "2500 - 5000 sq ft"
          },
          {
            "value": "over5000",
            "label": "5000+ sq ft"
          }
        ]
      },
      "validation": {
        "byServiceEnum": {
          "carpet": [
            "under500",
            "500to1000",
            "1000to1500",
            "1500to2000",
            "over2000"
          ],
          "postConstruction": [
            "under1000",
            "1000to2500",
            "2500to5000",
            "over5000"
          ]
        }
      },
      "helpText": "Choose closest sqft bracket.",
      "examples": [
        "1000to1500",
        "2500to5000"
      ]
    },
    {
      "key": "condition",
      "label": "Condition",
      "type": "select",
      "required": true,
      "step": 3,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          }
        ]
      },
      "options": [
        {
          "value": "light",
          "label": "Light"
        },
        {
          "value": "moderate",
          "label": "Moderate"
        },
        {
          "value": "heavy",
          "label": "Heavy"
        }
      ],
      "validation": {
        "enum": [
          "light",
          "moderate",
          "heavy"
        ]
      },
      "helpText": "Current soil/stain level.",
      "examples": [
        "moderate"
      ]
    },
    {
      "key": "stairsSteps",
      "label": "Stairs (steps)",
      "type": "integer",
      "required": true,
      "step": 4,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          }
        ]
      },
      "validation": {
        "min": 0,
        "max": 200
      },
      "helpText": "Number of carpeted steps.",
      "examples": [
        "12"
      ]
    },
    {
      "key": "hallways",
      "label": "Hallways / corridors",
      "type": "integer",
      "required": true,
      "step": 4,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          }
        ]
      },
      "validation": {
        "min": 0,
        "max": 50
      },
      "helpText": "Count hallways/corridors to include.",
      "examples": [
        "1"
      ]
    },
    {
      "key": "furnitureMoving",
      "label": "Furniture moving",
      "type": "select",
      "required": true,
      "step": 4,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          }
        ]
      },
      "options": [
        {
          "value": "none",
          "label": "None"
        },
        {
          "value": "light",
          "label": "Light"
        },
        {
          "value": "heavy",
          "label": "Heavy"
        }
      ],
      "validation": {
        "enum": [
          "none",
          "light",
          "heavy"
        ]
      },
      "helpText": "Select the level of furniture moving needed.",
      "examples": [
        "light"
      ]
    },
    {
      "key": "advancedStainRemoval",
      "label": "Advanced stain removal",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          }
        ]
      },
      "helpText": "Include advanced stain treatment add-on.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "odorElimination",
      "label": "Odor elimination",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          }
        ]
      },
      "helpText": "Include odor elimination treatment.",
      "examples": [
        "no"
      ]
    },
    {
      "key": "petTreatment",
      "label": "Pet treatment",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          }
        ]
      },
      "helpText": "Include pet-focused treatment.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "stainProtector",
      "label": "Stain protector",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          }
        ]
      },
      "helpText": "Include post-clean stain protector.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "unusualCondition",
      "label": "Flooding / mould / unusual condition",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "carpet"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "carpet"
          }
        ]
      },
      "helpText": "Flag unusual carpet conditions requiring review.",
      "examples": [
        "no"
      ]
    },
    {
      "key": "projectType",
      "label": "Project type",
      "type": "select",
      "required": true,
      "step": 1,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "options": [
        {
          "value": "residential",
          "label": "Residential"
        },
        {
          "value": "commercial",
          "label": "Commercial"
        }
      ],
      "validation": {
        "enum": [
          "residential",
          "commercial"
        ]
      },
      "helpText": "Select project category.",
      "examples": [
        "commercial"
      ]
    },
    {
      "key": "buildType",
      "label": "Build type",
      "type": "select",
      "required": true,
      "step": 1,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "options": [
        {
          "value": "renovation",
          "label": "Renovation"
        },
        {
          "value": "newBuild",
          "label": "New build"
        }
      ],
      "validation": {
        "enum": [
          "renovation",
          "newBuild"
        ]
      },
      "helpText": "Choose renovation vs new build.",
      "examples": [
        "newBuild"
      ]
    },
    {
      "key": "floors",
      "label": "Floors / levels",
      "type": "integer",
      "required": true,
      "step": 2,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "validation": {
        "min": 1,
        "max": 100
      },
      "helpText": "Number of levels involved.",
      "examples": [
        "2"
      ]
    },
    {
      "key": "stage",
      "label": "Cleaning stage",
      "type": "select",
      "required": true,
      "step": 3,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "options": [
        {
          "value": "rough",
          "label": "Rough"
        },
        {
          "value": "light",
          "label": "Light"
        },
        {
          "value": "final",
          "label": "Final"
        },
        {
          "value": "touchUp",
          "label": "Touch-up"
        }
      ],
      "validation": {
        "enum": [
          "rough",
          "light",
          "final",
          "touchUp"
        ]
      },
      "helpText": "Select cleanup stage.",
      "examples": [
        "final"
      ]
    },
    {
      "key": "dustLoad",
      "label": "Dust load",
      "type": "select",
      "required": true,
      "step": 3,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "options": [
        {
          "value": "light",
          "label": "Light"
        },
        {
          "value": "medium",
          "label": "Medium"
        },
        {
          "value": "heavy",
          "label": "Heavy"
        }
      ],
      "validation": {
        "enum": [
          "light",
          "medium",
          "heavy"
        ]
      },
      "helpText": "How much dust/debris remains.",
      "examples": [
        "medium"
      ]
    },
    {
      "key": "interiorWindows",
      "label": "Interior windows",
      "type": "select",
      "required": true,
      "step": 4,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "options": [
        {
          "value": "none",
          "label": "None"
        },
        {
          "value": "small",
          "label": "Small"
        },
        {
          "value": "medium",
          "label": "Medium"
        },
        {
          "value": "large",
          "label": "Large"
        }
      ],
      "validation": {
        "enum": [
          "none",
          "small",
          "medium",
          "large"
        ]
      },
      "helpText": "Scope of interior window detailing.",
      "examples": [
        "medium"
      ]
    },
    {
      "key": "scraping",
      "label": "Sticker/paint scraping",
      "type": "select",
      "required": true,
      "step": 4,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "options": [
        {
          "value": "none",
          "label": "None"
        },
        {
          "value": "some",
          "label": "Some"
        },
        {
          "value": "lots",
          "label": "Lots"
        }
      ],
      "validation": {
        "enum": [
          "none",
          "some",
          "lots"
        ]
      },
      "helpText": "Select scraping intensity.",
      "examples": [
        "some"
      ]
    },
    {
      "key": "floorDetailing",
      "label": "Floor detailing",
      "type": "select",
      "required": true,
      "step": 4,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "options": [
        {
          "value": "none",
          "label": "None"
        },
        {
          "value": "small",
          "label": "Small"
        },
        {
          "value": "medium",
          "label": "Medium"
        },
        {
          "value": "large",
          "label": "Large"
        }
      ],
      "validation": {
        "enum": [
          "none",
          "small",
          "medium",
          "large"
        ]
      },
      "helpText": "Select floor detailing scope.",
      "examples": [
        "small"
      ]
    },
    {
      "key": "insideCabinets",
      "label": "Inside cabinets / drawers",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "helpText": "Include inside cabinet detailing.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "appliances",
      "label": "Appliance detailing",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "helpText": "Include appliance wipe/detailing.",
      "examples": [
        "no"
      ]
    },
    {
      "key": "specialDetailing",
      "label": "Special detailing (vents/baseboards/doors)",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "helpText": "Include specialty detail work.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "multiTenantAccess",
      "label": "Multi-tenant access coordination",
      "type": "boolean",
      "required": true,
      "step": 4,
      "appliesTo": [
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "equals": "postConstruction"
          }
        ]
      },
      "helpText": "Flag if multiple tenant access coordination is needed.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "schedule",
      "label": "Preferred timeline",
      "type": "select",
      "required": false,
      "step": 5,
      "appliesTo": [
        "carpet",
        "postConstruction"
      ],
      "conditional": {
        "all": [
          {
            "key": "serviceType",
            "in": [
              "carpet",
              "postConstruction"
            ]
          }
        ]
      },
      "options": [
        {
          "value": "asap",
          "label": "ASAP"
        },
        {
          "value": "nextWeek",
          "label": "Next week"
        },
        {
          "value": "flexible",
          "label": "Flexible"
        },
        {
          "value": "tomorrow",
          "label": "Tomorrow"
        }
      ],
      "validation": {
        "enum": [
          "asap",
          "nextWeek",
          "flexible",
          "tomorrow"
        ]
      },
      "helpText": "Preferred scheduling window.",
      "examples": [
        "asap"
      ]
    },
    {
      "key": "contact.fullName",
      "label": "Full name",
      "type": "string",
      "required": true,
      "step": 5,
      "appliesTo": [
        "window",
        "commercialWindow",
        "carpet",
        "postConstruction"
      ],
      "validation": {
        "minLength": 2,
        "maxLength": 160
      },
      "helpText": "Customer full name.",
      "examples": [
        "Jane Smith"
      ]
    },
    {
      "key": "contact.phone",
      "label": "Phone number",
      "type": "phone",
      "required": true,
      "step": 5,
      "appliesTo": [
        "window",
        "commercialWindow",
        "carpet",
        "postConstruction"
      ],
      "validation": {
        "minDigits": 7,
        "maxDigits": 20
      },
      "helpText": "Best callback number.",
      "examples": [
        "(236) 506-6570"
      ]
    },
    {
      "key": "contact.email",
      "label": "Email address",
      "type": "email",
      "required": true,
      "step": 5,
      "appliesTo": [
        "window",
        "commercialWindow",
        "carpet",
        "postConstruction"
      ],
      "validation": {
        "regex": "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
      },
      "helpText": "Email to send estimate details.",
      "examples": [
        "you@example.com"
      ]
    },
    {
      "key": "contact.address",
      "label": "Property address",
      "type": "string",
      "required": false,
      "step": 5,
      "appliesTo": [
        "window",
        "commercialWindow",
        "carpet",
        "postConstruction"
      ],
      "validation": {
        "maxLength": 250
      },
      "helpText": "Optional service address.",
      "examples": [
        "120 Parkside Crescent, Mitchell"
      ]
    },
    {
      "key": "contact.consentToContact",
      "label": "Consent to contact",
      "type": "boolean",
      "required": true,
      "step": 5,
      "appliesTo": [
        "window",
        "commercialWindow",
        "carpet",
        "postConstruction"
      ],
      "validation": {
        "mustBeTrue": true
      },
      "helpText": "Required permission to contact customer about estimate/project.",
      "examples": [
        "yes"
      ]
    },
    {
      "key": "contact.marketingOptIn",
      "label": "Marketing opt-in",
      "type": "boolean",
      "required": false,
      "step": 5,
      "appliesTo": [
        "window",
        "commercialWindow",
        "carpet",
        "postConstruction"
      ],
      "helpText": "Optional offers/updates permission.",
      "examples": [
        "no"
      ]
    }
  ]
} as const;
