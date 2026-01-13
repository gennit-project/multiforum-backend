export var CollectionItemType;
(function (CollectionItemType) {
    CollectionItemType["Channel"] = "CHANNEL";
    CollectionItemType["Comment"] = "COMMENT";
    CollectionItemType["Discussion"] = "DISCUSSION";
    CollectionItemType["Download"] = "DOWNLOAD";
    CollectionItemType["Image"] = "IMAGE";
})(CollectionItemType || (CollectionItemType = {}));
export var CollectionType;
(function (CollectionType) {
    CollectionType["Channels"] = "CHANNELS";
    CollectionType["Comments"] = "COMMENTS";
    CollectionType["Discussions"] = "DISCUSSIONS";
    CollectionType["Downloads"] = "DOWNLOADS";
    CollectionType["Images"] = "IMAGES";
})(CollectionType || (CollectionType = {}));
export var CollectionVisibility;
(function (CollectionVisibility) {
    CollectionVisibility["Private"] = "PRIVATE";
    CollectionVisibility["Public"] = "PUBLIC";
})(CollectionVisibility || (CollectionVisibility = {}));
export var EventType;
(function (EventType) {
    EventType["Create"] = "CREATE";
    EventType["CreateRelationship"] = "CREATE_RELATIONSHIP";
    EventType["Delete"] = "DELETE";
    EventType["DeleteRelationship"] = "DELETE_RELATIONSHIP";
    EventType["Update"] = "UPDATE";
})(EventType || (EventType = {}));
export var FileKind;
(function (FileKind) {
    FileKind["Blend"] = "BLEND";
    FileKind["Glb"] = "GLB";
    FileKind["Jpg"] = "JPG";
    FileKind["Other"] = "OTHER";
    FileKind["Png"] = "PNG";
    FileKind["Rar"] = "RAR";
    FileKind["Stl"] = "STL";
    FileKind["Zip"] = "ZIP";
})(FileKind || (FileKind = {}));
export var FilterMode;
(function (FilterMode) {
    FilterMode["Exclude"] = "EXCLUDE";
    FilterMode["Include"] = "INCLUDE";
})(FilterMode || (FilterMode = {}));
export var PipelineCondition;
(function (PipelineCondition) {
    PipelineCondition["Always"] = "ALWAYS";
    PipelineCondition["PreviousFailed"] = "PREVIOUS_FAILED";
    PipelineCondition["PreviousSucceeded"] = "PREVIOUS_SUCCEEDED";
})(PipelineCondition || (PipelineCondition = {}));
export var PriceModel;
(function (PriceModel) {
    PriceModel["Fixed"] = "FIXED";
    PriceModel["Free"] = "FREE";
    PriceModel["NameYourPrice"] = "NAME_YOUR_PRICE";
    PriceModel["Subscription"] = "SUBSCRIPTION";
    PriceModel["Temporary"] = "TEMPORARY";
})(PriceModel || (PriceModel = {}));
export var RepeatUnit;
(function (RepeatUnit) {
    RepeatUnit["Day"] = "DAY";
    RepeatUnit["Month"] = "MONTH";
    RepeatUnit["Week"] = "WEEK";
    RepeatUnit["Year"] = "YEAR";
})(RepeatUnit || (RepeatUnit = {}));
export var ScanStatus;
(function (ScanStatus) {
    ScanStatus["Clean"] = "CLEAN";
    ScanStatus["Failed"] = "FAILED";
    ScanStatus["Infected"] = "INFECTED";
    ScanStatus["Pending"] = "PENDING";
    ScanStatus["Suspicious"] = "SUSPICIOUS";
})(ScanStatus || (ScanStatus = {}));
export var SecretValidationStatus;
(function (SecretValidationStatus) {
    SecretValidationStatus["Invalid"] = "INVALID";
    SecretValidationStatus["NotSet"] = "NOT_SET";
    SecretValidationStatus["SetUntested"] = "SET_UNTESTED";
    SecretValidationStatus["Valid"] = "VALID";
})(SecretValidationStatus || (SecretValidationStatus = {}));
/** An enum for sorting in either ascending or descending order. */
export var SortDirection;
(function (SortDirection) {
    /** Sort by field values in ascending order. */
    SortDirection["Asc"] = "ASC";
    /** Sort by field values in descending order. */
    SortDirection["Desc"] = "DESC";
})(SortDirection || (SortDirection = {}));
export var SortType;
(function (SortType) {
    SortType["Hot"] = "hot";
    SortType["New"] = "new";
    SortType["Top"] = "top";
})(SortType || (SortType = {}));
export var TimeFrame;
(function (TimeFrame) {
    TimeFrame["All"] = "all";
    TimeFrame["Day"] = "day";
    TimeFrame["Month"] = "month";
    TimeFrame["Week"] = "week";
    TimeFrame["Year"] = "year";
})(TimeFrame || (TimeFrame = {}));
