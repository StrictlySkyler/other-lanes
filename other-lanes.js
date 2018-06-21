
require('child_process').execSync('npm i lodash');

let _ = require('lodash');

let Lanes;
let Harbors;
let Shipments;

const NAME = 'other lanes';

module.exports = {
  render_input: function (values, rendered_lane) {
    return `
      <p>To which other lanes would you like to ship?</p>
      <ul class="lane-input-list">
        ${Lanes.find({}, { sort: { name: 1 } }).fetch().map((lane) => {
          if (rendered_lane && lane._id != rendered_lane._id) return `
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
          return ``;
        }).join('')
        }
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
      <ul class="lane-list">
        ${Object.keys(manifest).map(key => {
          let lane;
          if (manifest[key] == 'on') lane = Lanes.findOne(key);
          if (lane) return `
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
          return '';
        }).join('')}
      </ul>
      <p>Followup lanes on each of these lanes' charter will ${
        manifest.follow_charter ? '' : '<em>not</em> '
      }be tracked.</p>
    `;
  },

  register: function (lanes, users, harbors, shipments) {
    Lanes = lanes;
    Users = users;
    Harbors = harbors;
    Shipments = shipments;

    return NAME;
  },

  update: function (lane, values) {
    if (! values[lane._id]) return true;

    return false;
  },

  work: function (lane, manifest) {

    let check_completion = function () {
      console.log('Checking completion for lane:', lane.name);
      let all_shipments_successful = _.every(complete, function (value) {
        return value == 0;
      });
      let total_length = targets.length + followups.length;

      if (total_complete == total_length && all_shipments_successful) {
        console.log('Shipment successful for lane:', lane.name);
        exit_code = 0;
      }

      if (total_complete == total_length) {
        console.log('Ending shipment for lane:', lane.name);
        $H.end_shipment(lane, exit_code, manifest);
      }

      return all_shipments_successful;
    };

    let collect_followups = function (target_lane) {
      let downstream = [];

      if (target_lane.followup) {
        let followup_lane = Lanes.findOne(target_lane.followup);

        downstream.push(followup_lane);

        downstream = downstream.concat(collect_followups(followup_lane));
      }

      if (target_lane.salvage_plan) {
        let salvage_plan_lane = Lanes.findOne(target_lane.salvage_plan);

        downstream.push(salvage_plan_lane);

        downstream = downstream.concat(collect_followups(salvage_plan_lane));
      }

      console.log(downstream)
      return downstream;
    };

    let verify_lane_key = function (value, key) {
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

    let collect_target_list = function () {
      _.each(manifest, function (value, key) {
        let target_lane;

        if ( verify_lane_key(value, key) ) {
          target_lane = Lanes.findOne(key);
          targets.push(target_lane);
        }

        if (target_lane && manifest.follow_charter) {
          followups = followups.concat(collect_followups(target_lane));
        }
      });
    };

    let check_shipment_status = function (lane_id, updated_shipment, observer) {
      if (
        updated_shipment.active == false &&
        (updated_shipment.exit_code == 0 || updated_shipment.exit_code) &&
        complete[lane_id] === false
      ) {
        total_complete++;
        complete[lane_id] = updated_shipment.exit_code;

        let lane = Lanes.findOne(lane_id);
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

        shipment.stdout.push({
          date: new Date(),
          result,
        });
        Shipments.update(shipment._id, shipment);
        observer.stop();
      }

      return check_completion();
    };

    let observe_targets = function () {
      let the_observed = targets.concat(followups);

      _.each(the_observed, function (observed) {
        complete[observed._id] = false;

        let cursor = Shipments.find({ lane: observed._id });
        let observer = cursor.observe({
          changed: function (newShipment) {
            let lane_id = newShipment.lane;
            check_shipment_status(lane_id, newShipment, observer);
          },
        });
      });
    };

    let start_shipments = () => {
      _.each(targets, (target_lane) => {
        let harbor = Harbors.findOne(target_lane.type);
        let target_manifest = harbor.lanes[target_lane._id].manifest;
        $H.start_shipment(target_lane._id, target_manifest, start_date);
      });
    };

    let shipment = Shipments.findOne(manifest.shipment_id);
    let total_complete = 0;
    let complete = {};
    let targets = [];
    let followups = [];
    let exit_code = 1;
    let start_date = manifest.shipment_start_date;

    collect_target_list();

    observe_targets();

    start_shipments();

    return manifest;
  },
};
