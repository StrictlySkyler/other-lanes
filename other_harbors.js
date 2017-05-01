'use strict';

let Lanes;
let Users;
let Harbors;
let Shipments;

const NAME = 'other_harbors';

module.exports = {
  render_input: function (values) {
    return `
      <p>To which other lanes would you like to ship?</p>
      <ul class="lane-input-list">
        ${Lanes.find({}, { sort: { name: 1 } }).fetch().map(lane =>
            `<li>
              <label>
                <input
                  name=${lane._id}
                  type=checkbox
                  ${values && values[lane._id] ? 'checked' : ''}
                >
                ${lane.name}
              </label>
            </li>`
          ).join('')
        }
      </ul>
    `
  },

  render_work_preview: function (manifest) {
    return `
      <p>This shipment will start shipments to the following lanes:</p>
      <ul class="lane-list">
        ${Object.keys(manifest).map(lane => {
          if (manifest[lane]) {
            lane = Lanes.findOne(lane);
            return `<li>${lane.name}</li>`;
          }
        }).join('')}
      </ul>
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
    let harbor = Harbors.findOne(lane.type);

    harbor.lanes[lane._id] = {
      manifest: values
    };

    Harbors.update(harbor._id, harbor);

    return true;
  },

  work: function (lane, manifest) {
    function check_completion () {
      console.log('Checking completion for lane:', lane.name);
      let all_shipments_successful = _.every(complete, function (value) {
        return value == 0;
      });

      if (total_complete == targets.length && all_shipments_successful) {
        console.log('Shipment successful for lane:', lane.name);
        exit_code = 0;
      }

      if (total_complete == targets.length) {
        console.log('Ending shipment for lane:', lane.name);
        $H.call('Lanes#end_shipment', lane, exit_code, manifest)
      }

      return all_shipments_successful;
    }

    let shipment = Shipments.findOne({
      lane: lane._id,
      start: manifest.shipment_start_date
    });
    let complete = {};
    let total_complete = 0;
    let targets = [];
    let exit_code = 1;

    _.each(manifest, function (value, key) {
      let target_lane;

      if (value && key != 'shipment_start_date' && key != 'prior_manifest') {
        target_lane = Lanes.findOne(key);
      }

      if (target_lane) targets.push(target_lane);
    });

    _.each(targets, function (target_lane) {
      //throw new Error('test');
      let harbor = Harbors.findOne(target_lane.type);
      let manifest = harbor.lanes[target_lane._id].manifest;
      //TODO: get this from $H
      let date = new Date();
      let start_date = date.getFullYear() + '-' +
        date.getMonth() + '-' +
        date.getDate() + '-' +
        date.getHours() + '-' +
        date.getMinutes() + '-' +
        date.getSeconds()
      ;

      let shipment_cursor = Shipments.find({
        lane: target_lane._id,
        start: start_date
      });

      let observer = shipment_cursor.observeChanges({

        added: function (id, fields) {
          let lane_shipment = Shipments.findOne({
            lane: target_lane._id,
            start: start_date
          });

          complete[lane_shipment._id] = false;
        },

        changed: function check_shipment_status (id, fields) {
          if (
            fields.active == false &&
            (fields.exit_code == 0 || fields.exit_code)
          ) {
            total_complete++;
            complete[id] = fields.exit_code;
            observer.stop();
            shipment.stdout.push({
              date: new Date(),
              result: (
                'Lane "' +
                target_lane.name + 
                '" exited with code: ' +
                fields.exit_code
              )
            });
            Shipments.update(shipment._id, shipment);

            return check_completion();
          }
        }
      });

      $H.call('Lanes#start_shipment', target_lane._id, manifest, start_date);

    });

    return manifest;
  }
};
