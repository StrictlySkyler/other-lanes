
let _;

let Lanes;
let Harbors;
let Shipments;

const name = 'other lanes';
const pkgs = ['lodash'];


const prune_followup = (lane, observers, complete, downstream) => {
  console.log(
    `Pruning unused followup "${lane.followup.name}" from tracking due to non-zero exit from ${lane.name}`
  );
  observers[lane.followup._id].stop();
  delete observers[lane.followup._id];
  delete complete[lane.followup._id];
  _.remove(downstream, (followup) => {
    return followup._id == lane.followup._id;
  });
  if (lane.followup?.followup) {
    prune_followup(lane.followup, observers, complete, downstream);
  }
  if (lane.salvage_plan?.salvage_plan) {
    prune_salvage_plan(lane.salvage_plan, observers, complete, downstream);
  }
};

const prune_salvage_plan = (lane, observers, complete, downstream) => {
  console.log(
    `Pruning unused salvage plan "${lane.salvage_plan.name}" from tracking due to successful exit from ${lane.name}`
  );

  observers[lane.salvage_plan._id]?.stop();
  delete observers[lane.salvage_plan._id];
  delete complete[lane.salvage_plan._id];
  _.remove(downstream, (salvage_plan) => {
    return salvage_plan._id == lane.salvage_plan._id;
  });
  if (lane.followup?.followup) {
    prune_followup(lane.followup, observers, complete, downstream);
  }
  if (lane.salvage_plan?.salvage_plan) {
    prune_salvage_plan(lane.salvage_plan, observers, complete, downstream);
  }
};

const check_completion = function (
  ref_lane, 
  complete, 
  targets, 
  downstream, 
  total_complete, 
  exit_code, 
  manifest
) {
  console.log('Checking completion for lane:', ref_lane.name);
  let all_shipments_successful = _.every(complete, function (value) {
    return value === 0;
  });
  let total_length = targets.length + downstream.length;
  if (total_complete.count == total_length && all_shipments_successful) {
    console.log('Shipment successful for lane:', ref_lane.name);
    exit_code = 0;
  }

  if (total_complete.count == total_length) {
    console.log('Ending shipment for lane:', ref_lane.name);
    $H.end_shipment(ref_lane, exit_code, manifest);
  }

  return all_shipments_successful;
};

const collect_downstream = function (target_lane) {
  let collected = [];
  
  if (target_lane.followup) {
    let followup_lane = Lanes.findOne(target_lane.followup._id);

    collected.push(followup_lane);

    collected = collected.concat(collect_downstream(followup_lane));
  }

  if (target_lane.salvage_plan) {
    let salvage_plan_lane = Lanes.findOne(target_lane.salvage_plan._id);

    collected.push(salvage_plan_lane);

    collected = collected.concat(collect_downstream(salvage_plan_lane));
  }

  return _.uniqBy(collected, '_id');
};

const verify_lane_key = function (value, key) {
  if (
    value &&
    key != 'shipment_start_date' &&
    key != 'prior_manifest' &&
    key != 'follow_charter' &&
    key != 'shipment_id' &&
    key != 'timestamp'
  ) return true;

  return false;
};

const collect_target_lists = function (manifest, targets, downstream) {
  _.each(manifest, function (value, key) {
    let target_lane;

    if ( verify_lane_key(value, key) ) {
      target_lane = Lanes.findOne(key);
      targets.push(target_lane);
    }

    if (target_lane && manifest.follow_charter) {
      downstream = downstream.concat(collect_downstream(target_lane));
    }
  });
  return { targets, downstream };
};

const check_shipment_status = function (
  lane_id, 
  ref_shipment, 
  updated_shipment, 
  observer, 
  total_complete,
  observers,
  complete, 
  targets, 
  downstream, 
  exit_code, 
  manifest,
  ref_lane
) {
  let lane = Lanes.findOne(lane_id);
  
  if (
    updated_shipment.active == false &&
    (updated_shipment.exit_code == 0 || updated_shipment.exit_code) &&
    complete[lane_id] === false
  ) {
    total_complete.count++;
    complete[lane_id] = updated_shipment.exit_code;

    let shipment_link = `/lanes/${
      lane.name
    }/ship/${
      updated_shipment.start
    }`;
    let link_classes = `exit-code code-${updated_shipment.exit_code}`;
    let result = `<a
      class="${link_classes}"
      href="${shipment_link}"
    >Lane "${
      lane.name
    }" exited with code: ${
      updated_shipment.exit_code
    }</a>`;

    const date = new Date();

    switch (updated_shipment.exit_code) {
      case 0:
        if (lane.salvage_plan) {
          prune_salvage_plan(lane, observers, complete, downstream);
        }
        break;
      default:
        if (lane.followup) {
          prune_followup(lane, observers, complete, downstream);
        }
        break;
    }
    observer.stop();

    let { stdout } = Shipments.findOne(ref_shipment._id);
    stdout[date] = stdout[date] ? `${stdout[date]}\n${result}` : result;
    ref_shipment.stdout = stdout;
    Shipments.update(ref_shipment._id, ref_shipment);
  }

  if (updated_shipment.exit_code) {
    return $H.end_shipment(lane, updated_shipment.exit_code, manifest);
  }

  return check_completion(
    ref_lane, 
    complete, 
    targets, 
    downstream, 
    total_complete, 
    exit_code, 
    manifest
  );

};

const observe_targets = function (
  targets,
  downstream,
  complete,
  observers,
  ref_shipment,
  total_complete,
  complete,
  exit_code,
  manifest,
  ref_lane
) {
  let the_observed = targets.concat(downstream);

  _.each(the_observed, function (observed) {
    complete[observed._id] = false;

    const cursor = Shipments.find({ lane: observed._id });
    observers[observed._id] = cursor.observe({
      changed: function (updated_shipment) {
        let lane_id = updated_shipment.lane;
        check_shipment_status(
          lane_id, 
          ref_shipment,
          updated_shipment, 
          observers[observed._id],
          total_complete,
          observers,
          complete, 
          targets, 
          downstream, 
          exit_code, 
          manifest,
          ref_lane
        );
      },
    });
  });
  return observers;
};

const start_shipments = (targets, start_date) => {
  _.each(targets, (target_lane) => {
    const harbor = Harbors.findOne(target_lane.type);
    let target_manifest = harbor.lanes[target_lane._id].manifest;
    $H.start_shipment(target_lane._id, target_manifest, start_date);
  });
};

module.exports = {
  prune_followup,
  prune_salvage_plan,
  check_completion,
  collect_downstream,
  verify_lane_key,
  collect_target_lists,
  check_shipment_status,
  observe_targets,
  start_shipments,
  next: () => (_ = require('lodash')),

  render_input: function (values, rendered_lane) {
    let lanes = Lanes.find({}, { sort: { name: 1 } }).fetch().map((lane) => {
      if (rendered_lane && lane._id != rendered_lane._id) {
        return `
          <li>
            <label>
              <input
                name=${lane._id}
                type=checkbox
                ${values && values[lane._id] ? 'checked' : ''}
              >
              ${lane.name}
            </label>
          </li>
        `;
      }
      return ``;
    }).join('');

    if (! lanes.length) return '<p>(No other lanes found.)</p>';

    return `
      <p>To which other lanes would you like to ship?</p>
      <ul class="lane-input-list">
        ${lanes}
      </ul>
      <label>
        <input
          name=follow_charter
          type=checkbox
          ${values && values.follow_charter ? 'checked' : ''}
        >
        Follow Charter?
      </label>
    `;
  },

  render_work_preview: function (manifest) {
    return `
      <p>This shipment will start shipments to the following lanes:</p>
      <ul class="other-lane-list">
        ${Object.keys(manifest).map(key => {
          let lane;
          if (manifest[key] == 'on') lane = Lanes.findOne(key);
          if (lane) {
            return `
              <li>
                <a
                  href="/lanes/${lane.name}/ship"
                  class="success button"
                >${lane.name}</a>
                <a
                  href="/lanes/${lane.name}/charter"
                  class="button"
                >charter</a>
              </li>
            `;
          }
          return '';
        }).join('')}
      </ul>
      <p>Each of these lanes' charter will ${
        manifest.follow_charter ? '' : '<em>not</em> '
      }be tracked.</p>
    `;
  },

  register: function (lanes, users, harbors, shipments) {
    Lanes = lanes;
    Users = users;
    Harbors = harbors;
    Shipments = shipments;

    return { name, pkgs };
  },

  update: function (lane, values) {
    if (! values[lane._id]) return true;

    return false;
  },

  work: function (ref_lane, manifest) {

    let ref_shipment = Shipments.findOne(manifest.shipment_id);
    let total_complete = { count: 0 };
    let complete = {};
    let observers = {};
    let targets = [];
    let downstream = [];
    let exit_code = 1;
    const start_date = manifest.shipment_start_date;

    const lists = collect_target_lists(manifest, targets, downstream);
    targets = lists.targets;
    downstream = lists.downstream;

    observers = observe_targets(
      targets,
      downstream,
      complete,
      observers,
      ref_shipment,
      total_complete,
      complete,
      exit_code,
      manifest,
      ref_lane
    );

    start_shipments(targets, start_date);

    return manifest;
  },
};
