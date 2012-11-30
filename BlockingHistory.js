var busySpinner = null;
var rallyDataSource = null;
var iterationDropdown = null;
var ACTIVE = "Active";
var BLOCKED = "Blocked";
var taskTable, storyTable, taskHistoryTable;

var blockedTasks = {};  // key with story.FormattedID, value is an Array with elements of:
//    {task.FormattedID, task.Name,
//     current schedule state of Task, task blocked status,
//     task.RevisionHistory}

function byRevisionNumber(a, b) {
    return a.RevisionNumber - b.RevisionNumber;
}

function byTaskFormattedID(a, b) {
    var a_num = parseInt(a.FormattedID.substring(2, a.length), 10);
    var b_num = parseInt(b.FormattedID.substring(2, b.length), 10);
    return a_num - b_num;
}
 
function detectBlockedStories(stories) {
    var blocked_stories = [];   // this gets populated with UserStory objects
    for (var ix = 0; ix < stories.length; ix++) {
        var story = stories[ix];
        var revisions = story.RevisionHistory.Revisions;
        revisions.sort(byRevisionNumber);

        var story_was_blocked = false;
        // it doesn't matter how many revs have been in BLOCKED state, presence of one is sufficient
        for (var rix = 0; rix < revisions.length && story_was_blocked === false; rix++) {
            var rev = revisions[rix];
            if (rev.Description.indexOf("BLOCKED changed from ") >= 0) {
                story_was_blocked = true;
            }
        }
        if (!story_was_blocked)   // only iterate through the story tasks if the story itself has never been blocked
        {
            var tasks = story.Tasks;
            var task = null;

            var task_was_blocked = false;
            tasks.sort(byTaskFormattedID);
            for (var tix = 0; tix < tasks.length; tix++) {
                task = tasks[tix];
                task_was_blocked = false;
                var trevs = task.RevisionHistory.Revisions;
                trevs.sort(byRevisionNumber);
                for (var trix = 0; trix < trevs.length && !task_was_blocked; trix++) {
                    var trev = trevs[trix];
                    if (trev.Description.indexOf("BLOCKED changed from ") >= 0) {
                        task_was_blocked = true;
                    }
                }
                if (task_was_blocked === true) {
                    story_was_blocked = true;
                }
            }
        }

        if (story_was_blocked) {
            blocked_stories.push(story);
        }
    }
    return blocked_stories;
}

function itemStatus(item, revisions) {
    // given an item (story or task) and an array of revisions
    // (either from UserStory or Task), iterate through the revisions
    // The item.Blocked status trumps any 'BLOCKED' status detected in the revision list
    var current_status = ACTIVE;   // prime the state value
    var wasBlocked = false;
    revisions.sort(byRevisionNumber);
    for (var rix = 0; rix < revisions.length; rix++) {
        var rev = revisions[rix];
        if (rev.Description.indexOf("BLOCKED changed from [false] to [true]") >= 0) {
            current_status = BLOCKED;
            wasBlocked = true;
        }
        if (rev.Description.indexOf("BLOCKED changed from [true] to [false]") >= 0) {
            current_status = ACTIVE;
        }
    }
    if (item.Blocked === true)  // in the case where rev hist doesn't show blockage but item is blocked
    {
        current_status = BLOCKED;
        wasBlocked = true;
    }
    return {'currentStatus': current_status, 'wasBlocked': wasBlocked};
}

function currentStoryState(story) {
    // blockedTasks is a purposeful global...
    blockedTasks[story.FormattedID] = [];
    var storyStatus = itemStatus(story, story.RevisionHistory.Revisions);
    var state = storyStatus.currentStatus;

    //  iterate through the story tasks.  If the current state of any of the tasks
    //  is blocked, then the story itself shall be classified as being blocked.
    //  We are also going to update a running count of the number of tasks blocked for this story

    var tasks_blocked = 0;
    var task = null;
    var taskStatus = null;
    var taskInfo = {};
    var storyInfo = {};

    for (var tix = 0; tix < story.Tasks.length; tix++) {
        task = story.Tasks[tix];
        taskStatus = itemStatus(task, task.RevisionHistory.Revisions);
        if (taskStatus.wasBlocked) {
            taskInfo = {'taskID'  : task.FormattedID,
                'name'    : task.Name,
                'state'   : task.State,
                'status'  : taskStatus.currentStatus,
                'revHist' : task.RevisionHistory
            };
            blockedTasks[story.FormattedID].push(taskInfo);
        }
        if (taskStatus.currentStatus == BLOCKED) {
            tasks_blocked++;
        }
    }

    if (tasks_blocked > 0) {
        state = BLOCKED;
        var blocked_tasks = blockedTasks[story.FormattedID];
        var taskIDs = dojo.map(blocked_tasks, function (t) {
            return t.taskID;
        });
    }

    storyInfo = {'storyID'      : story.FormattedID,
        'schedState'   : story.ScheduleState,
        'blocked'      : story.Blocked.toString(),
        'state'        : state,
        'numTasks'     : story.Tasks.length.toString(),
        'tasksBlocked' : tasks_blocked.toString()
    };

    return storyInfo;
}

function makeFuncLink(functionName, paramValues, linkText) {
    // token substitution for FUNCTION_NAME, PARAMS and LINK_TEXT
    // Note that each parm in the parm list must be enclosed in single quotes
    var funcLink = '<a href=\"#\" onclick=\"FUNCTION_NAME(PARAMS); return false;\"><nobr>LINK_TEXT</nobr></a>';
    funcLink = funcLink.replace('FUNCTION_NAME', functionName);
    funcLink = funcLink.replace('LINK_TEXT', linkText);
    var singleQuoteEnclose = function (parmValue) {
        return "'" + parmValue + "'";
    };
    var parms = dojo.map(paramValues, singleQuoteEnclose);
    funcLink = funcLink.replace('PARAMS', parms.join(", "));
    return funcLink;
}

function showBlockedStories(blocked_stories) {
    if (blocked_stories.length > 0) {
        var tblConfig = { "columnKeys"    : ['StoryID', 'SchedState', 'Status', 'NumTasks',
            'CurrBlockedTasks', 'TaskDetails'],
            "columnHeaders" : ["User Story", "Schedule State", "Status", "# of Tasks",
                "# Currently <br>Blocked Tasks", "Tasks Details"],
            "columnWidths"  : ['75px', '90px', '75px', '70px', '85px', '100px'],
            "height" : "180px"
        };
        storyTable = new rally.sdk.ui.Table(tblConfig);
        var blocked = dojo.map(blocked_stories, currentStoryState);
        var tasksLink = "";
        for (var ix = 0; ix < blocked.length; ix++) {
            var item = blocked[ix];
            storyTable.setCell(ix, 'StoryID', item.storyID);
            storyTable.setCell(ix, 'SchedState', item.schedState);
            storyTable.setCell(ix, 'Status', item.state);
            storyTable.setCell(ix, 'NumTasks', item.numTasks);
            storyTable.setCell(ix, 'CurrBlockedTasks', item.tasksBlocked);
            if (item.numTasks > 0) {
                tasksLink = makeFuncLink('showBlockingTasks', [item.storyID], 'Show Tasks');
                storyTable.setCell(ix, 'TaskDetails', tasksLink);
            }
            else {
                storyTable.setCell(ix, 'TaskDetails', "");
            }
        }
        var blockHistDiv = document.getElementById('blockHistDiv');
        storyTable.display(blockHistDiv);
    }
    else {
        var noBlockedStories = "<br>There are no stories that have ever been blocked for " +
                iterationDropdown.getSelectedName();
        document.getElementById('blockHistDiv').innerHTML = noBlockedStories;
    }
}

function showBlockingTasks(storyID) {
    if(taskTable) {
        taskTable.destroy();
        taskTable = null;
    }

    if(taskHistoryTable) {
        taskHistoryTable.destroy();
        taskHistoryTable = null;
    }
    dojo.byId('taskHistoryDiv').innerHTML = "";
    
    var blockedTasksDiv = document.getElementById('blockedTasksDiv');
    blockedTasksDiv.innerHTML = "<h4>Tasks with Blocking History<br>User Story: " + storyID + "<\/h4>";

    //  See if there have ever been any blocked tasks associated with the storyID
    //  If not, blurt out text stating that
    var blocked_tasks = blockedTasks[storyID];
    if (blocked_tasks.length === 0) {
        blockedTasksDiv.innerHTML += "<p>There are no tasks associated with this story that were ever blocked.</p>";
        return;
    }

    // Otherwise, cook up a table and fill it with info related to the tasks associated with
    // the storyID that have been blocked at some point.
    var config = {};
    config = {"id" : "blockedTasks",
        "columnKeys"    : ["TaskID", "Name", "SchedState",     "CurrentStatus",  "TaskHistory"],
        "columnHeaders" : ["Task",   "Name", "Schedule State", "Current Status", "Task History"],
        "columnWidths"  : ['75px', '300px', '90px', '80px', '150px'],
        "height" : "140px"
    };
    taskTable = new rally.sdk.ui.Table(config);
    var taskBlockingHistoryLink = "";
    for (var ix = 0; ix < blocked_tasks.length; ix++) {
        var blockedTask = blocked_tasks[ix];
        taskTable.setCell(ix, 'TaskID', blockedTask.taskID);
        taskTable.setCell(ix, 'Name', "<nobr>" + blockedTask.name + "</nobr>");
        taskTable.setCell(ix, 'SchedState', blockedTask.state);
        taskTable.setCell(ix, 'CurrentStatus', blockedTask.status);
        taskBlockingHistoryLink = makeFuncLink('showBlockingTaskHistory', [storyID, blockedTask.taskID], 'Show Blocking History');
        taskTable.setCell(ix, 'TaskHistory', taskBlockingHistoryLink);
    }
    taskTable.display(blockedTasksDiv);
}

function createBlockageEpisode(startDate, rev) {
    var be =
    {
        'blockDate'    : rally.sdk.util.DateTime.fromIsoString(startDate, true),
        'blockRev'     : rev,
        'unBlockDate'  : "",
        'unBlockRev'   : "",
        'lagTime'      : "NA",
        'duration'     : function () {
            if (this.unBlockDate === "") {
                this.unBlockDate = "Currently Blocked";
            }
            else {
                this.unBlockDate = rally.sdk.util.DateTime.fromIsoString(this.unBlockDate, true);
                this.lagTime = this.calcDuration(this.blockDate, this.unBlockDate);
            }
        },
        'calcDuration' : function (startDate, endDate) {
            // Be aware that the rally.sdk.util.DateTime.getDifference function rounds when provided
            // a unit in the form of 'year', 'month', 'week', 'day', 'hour' ...
            // so the dur value that gets returned is often less than dead on the money precision.
            // If fine-precision is desired you'd need to start at the other end of the unit
            // spectrum ('second') and build up from there
            // Note also, that we arbitrarily limit our dur return value to 2 units of measure,
            // so you don't end up with something ridiculous like '4 years 11 months 3 weeks 6 days 5 hours'
            var dateFormatSpec = {'datePattern' : 'yyyy/MM/dd', 'selector' : 'date'};
            var refDate = startDate;
            var dur = "";
            var time_units = ['year', 'month', 'week', 'day', 'hour'];
            var unit = "";
            var units_used = 0;
            var interval = 0;
            for (var ix = 0; ix < time_units.length && units_used < 2; ix++) {
                unit = time_units[ix];
                interval = rally.sdk.util.DateTime.getDifference(endDate, refDate, unit);
                if (interval > 0) {
                    dur += interval + " " + unit;
                    if (interval > 1) {
                        dur += "s";
                    }
                    dur += " ";
                    refDate = rally.sdk.util.DateTime.add(refDate, unit, interval);
                    units_used++;
                }

            }
            dur = dur.length > 0 ? dur : "&lt; 1 hour";
            return dur;
        }

    };
    return be;
}

function taskBlockingHistory(storyID, taskID) {
    // from the blockedStories hash, access the blocked tasks list and obtain the object
    // associated with the taskID,
    // iterate through the revisions.  Every time you see a blockage start, instantiate
    // a BlockageEpisode object with blockDate, blockRev, set the lagTime to 'NA'
    // and throw the BlockageEpisode on the blockages stack.
    // When you see a blockage end, access the BlockageEpisode on the top of the blockages
    // stack, and set the unblockDate and unblockRev.
    // return the stack (array) of BlockageEpisode instances

    var blockages = [];
    var blkg = null;
    var tasks = blockedTasks[storyID];
    var taskInfo = null;
    for (var tix = 0; tix < tasks.length && taskInfo === null; tix++) {
        var tskInfo = tasks[tix];
        if (tskInfo.taskID === taskID) {
            taskInfo = tskInfo;
        }
    }
    var revisions = taskInfo.revHist.Revisions;
    revisions.sort(byRevisionNumber);
    for (var rix = 0; rix < revisions.length; rix++) {
        var revision = revisions[rix];
        if (revision.RevisionNumber === 0) {
            blkg = createBlockageEpisode(revision.CreationDate, revision.RevisionNumber);
            blockages.push(blkg);
        }

        if (revision.Description.indexOf("BLOCKED changed from [false] to [true]") >= 0) {
            blkg = createBlockageEpisode(revision.CreationDate, revision.RevisionNumber);
            blockages.push(blkg);
        }
        else if (revision.Description.indexOf("BLOCKED changed from [true] to [false]") >= 0) {
            var episode = blockages.pop();
            episode.unBlockDate = revision.CreationDate;
            episode.unBlockRev = revision.RevisionNumber;
            blockages.push(episode);
        }
    }
    if (blockages.length > 1 && blockages[0].lagTime == 'NA') {
        blockages.splice(0, 1);  // deletes the first element in blockages
    }

    return blockages;
}

function showBlockingTaskHistory(storyID, taskID) {
    if(taskHistoryTable) {
        taskHistoryTable.destroy();
        taskHistoryTable = null;
    }
    var taskHistoryDiv = document.getElementById('taskHistoryDiv');
    taskHistoryDiv.innerHTML = "<br><br><h4>Blocking History for Task " + taskID + "</h4>";
    var config = {};
    config = {"id" : "taskBlockingHistory",
        "columnKeys"    : ["BlockedDate",  "UnblockedDate",  "LagTime"],
        "columnHeaders" : ["Blocked Date", "Unblocked Date", "Lag Time"],
        "columnWidths"  : ['100px', '100px', '140px'],
        "height" : "100px"
    };
    taskHistoryTable = new rally.sdk.ui.Table(config);
    var blockages = taskBlockingHistory(storyID, taskID);
    var bd = null;
    var dateFormatSpec = 'yyyy/MM/dd';
    for (var i = 0; i < blockages.length; i++) {
        var blockage = blockages[i];
        blockage.duration();   // call method to calculate and set the lagTime
        bd = rally.sdk.util.DateTime.format(blockage.blockDate, dateFormatSpec);
        var ubd = "Currently Blocked";
        if (blockage.unBlockDate !== "" && blockage.unBlockDate !== ubd) {
            ubd = rally.sdk.util.DateTime.format(blockage.unBlockDate, dateFormatSpec);
        }
        taskHistoryTable.setCell(i, 'BlockedDate', bd);
        taskHistoryTable.setCell(i, 'UnblockedDate', ubd);
        taskHistoryTable.setCell(i, 'LagTime', blockage.lagTime);
    }

    taskHistoryTable.display(taskHistoryDiv);
}

function runMainQuery() {

    if(taskTable) {
        taskTable.destroy();
        taskTable = null;
    }
    if(storyTable) {
        storyTable.destroy();
        storyTable = null;
    }
    if(taskHistoryTable) {
        taskHistoryTable.destroy();
        taskHistoryTable = null;
    }
    var blockHistDiv = dojo.byId('blockHistDiv');
    blockHistDiv.innerHTML = "";
    var blockedTasksDiv = dojo.byId('blockedTasksDiv');
    blockedTasksDiv.innerHTML = "";
    var taskHistoryDiv = dojo.byId('taskHistoryDiv');
    taskHistoryDiv.innerHTML = "";
    
    var showResults = function (results) {
        busySpinner.hide();
        var blocked_stories = detectBlockedStories(results.stories);
        showBlockedStories(blocked_stories);
    };

    var targetIterationName = iterationDropdown.getSelectedName();
    var queryConfig = { type : 'hierarchicalrequirement',
        key  : 'stories',
        fetch: 'Name,FormattedID,ScheduleState,CreationDate,' +
                'Blocked,RevisionHistory,Revisions,RevisionNumber,' +
                'Description,Tasks,State',
        order: 'FormattedID',
        query: '(Iteration.Name = ' + '\"' + targetIterationName + '\")'
    };

    busySpinner = new rally.sdk.ui.basic.Wait({});
    busySpinner.display('wait');
    rallyDataSource.findAll(queryConfig, showResults);
}
