import { useEffect, useState } from "react";
import { Form, Input, Button, Checkbox, Row, Col, Modal, InputNumber, message } from 'antd';
import 'antd/dist/antd.css';

const initBondData = {
  quoteToken: "0x7661B848380AFc32770Ce1a194CEFf12CdeacC71",
  capacity: 10000 * 1e18,
  price: 12 * 1e9,
  debtBuffer: 10 * 1e3,
  capacityInQuote: true,
  fixedTerm: true,
  vestingLength: 360,
  conclusion: 1642688827,
  depositInterval: 8640,
  tuneInterval: 86400
}

const getTimestamp = () => {
  return Math.round(new Date().getTime() / 1000)
}

const formatNumber = (_number) => {
  return new Intl.NumberFormat().format(Math.floor(_number))
}

function App() {

  const [isAddingBond, setIsAddingBond] = useState(getTimestamp)
  const [timestamp, setTimestamp] = useState()

  const [prices, setPrices] = useState([])
  const [baseSupply, setBaseSupply] = useState(1000000 * 1e9)
  const [markets, setMarkets] = useState([])
  const [terms, setTerms] = useState([])
  const [metadatas, setMetadatas] = useState([])
  const [adjustments, setAdjustments] = useState({})
  const [notes, setNotes] = useState([])

  const [form] = Form.useForm();

  useEffect(() => {
    var timerID = setInterval(() => tick(), 1000);

    return function cleanup() {
      clearInterval(timerID);
    };
  });

  function tick() {
    setTimestamp(getTimestamp);
    setPrices(markets.map((market, id) => _marketPrice(id)))
  }

  // useEffect(() => {
  // console.log("=============================")
  // console.log("markets: ", markets)
  // console.log("terms: ", terms)
  // console.log("metadatas: ", metadatas)
  // console.log("marketsForQuote: ", marketsForQuote)
  // console.log("notes: ", notes)
  // console.log("prices: ", prices)
  // })

  const deposit = (_id, _amount, _maxPrice, _user, _referral) => {

    const market = { ...markets[_id] }
    const term = { ...terms[_id] }
    const metadata = { ...metadatas[_id] }

    const currentTime = timestamp

    if (currentTime > term.conclusion) return message.error("Depository: market concluded")

    _decay(_id, currentTime)

    const price = _marketPrice(_id);
    if (price > _maxPrice) return message.error("Depository: more than max price")

    const payout_ = (_amount * 1e18 / price) / (10 ** metadata.quoteDecimals)

    if (payout_ >= market.maxPayout) return message.error("Depository: max size exceeded")

    const capacitySub = market.capacityInQuote ? _amount : payout_
    market.capacity = market.capacity - capacitySub

    const expiry_ = term.fixedTerm ? term.vesting + currentTime : term.vesting

    market.purchased += _amount
    market.sold += payout_
    market.totalDebt += payout_

    addNote(_user, payout_, expiry_, _id, _referral)

    message.info("Depository: User transfer quote token in this step")

    if (term.maxDebt < market.totalDebt) {
      market.capacity = 0;
    } else {
      _tune(_id, currentTime);
    }

    setMarkets([...markets].map((item, index) => index === _id ? market : item))

  }

  const _decay = (_id, _time) => {

    const market = { ...markets[_id] }
    const metadata = { ...metadatas[_id] }
    const term = { ...terms[_id] }

    market.totalDebt -= debtDecay(_id);
    metadata.lastDecay = _time

    setMarkets([...markets].map((item, index) => index === _id ? market : item))
    setMetadatas([...metadatas].map((item, index) => index === _id ? metadata : item))

    if (adjustments[_id] && adjustments[_id].active) {
      const adjustment = { ...adjustments[_id] }
      const { adjustBy, secondsSince, stillActive } = _controlDecay(_id)

      terms.controlVariable -= adjustBy;
      setTerms([...terms].map((item, index) => index === _id ? term : item))

      if (stillActive) {
        adjustment.change -= adjustBy;
        adjustment.timeToAdjusted -= secondsSince;
        adjustment.lastAdjustment = _time;
      } else {
        adjustment.active = false;
      }

      setAdjustments({
        ...adjustments,
        [_id]: adjustment
      })

    }
  }

  const _tune = (_id, _time) => {
    const meta = { ...metadatas[_id] }
    const market = { ...markets[_id] }
    const term = { ...terms[_id] }

    if (_time >= meta.lastTune + meta.tuneInterval) {
      const timeRemaining = term.conclusion - _time
      const price = _marketPrice(_id)

      const capacity = market.capacityInQuote ? (market.capacity * 1e18 / price) / (10 ** meta.quoteDecimals) : market.capacity

      markets.maxPayout = capacity * meta.depositInterval / timeRemaining

      const targetDebt = capacity * meta.length / timeRemaining

      const newControlVariable = price * baseSupply / targetDebt

      if (newControlVariable >= term.controlVariable) {
        term.controlVariable = newControlVariable;
      } else {
        const change = term.controlVariable - newControlVariable;
        setAdjustments({
          ...adjustments,
          [_id]: {
            change: change,
            lastAdjustment: _time,
            timeToAdjusted: meta.tuneInterval,
            active: true
          }
        })
      }

      meta.lastTune = _time;
    }

    setMarkets([...markets].map((item, index) => index === _id ? market : item))
    setTerms([...terms].map((item, index) => index === _id ? term : item))
    setMetadatas([...metadatas].map((item, index) => index === _id ? meta : item))
  }

  const create = (_quoteToken, _market, _booleans, _terms, _intervals) => {

    const secondsToConclusion = _terms[1] - timestamp

    const decimals = 18

    const targetDebt = _booleans[0] ? (_market[0] * 1e18 / _market[1]) / 10 ** decimals : _market[0]

    const maxPayout = targetDebt * _intervals[0] / secondsToConclusion

    const maxDebt = targetDebt + (targetDebt * _market[2] / 1e5)

    const controlVariable = _market[1] * baseSupply / targetDebt

    setMarkets([...markets, {
      quoteToken: _quoteToken,
      capacityInQuote: _booleans[0],
      capacity: _market[0],
      totalDebt: targetDebt,
      maxPayout: maxPayout,
      purchased: 0,
      sold: 0
    }])

    setTerms([...terms, {
      fixedTerm: _booleans[1],
      controlVariable: controlVariable,
      vesting: _terms[0],
      conclusion: _terms[1],
      maxDebt: maxDebt
    }])

    setMetadatas([...metadatas, {
      lastTune: timestamp,
      lastDecay: timestamp,
      length: secondsToConclusion,
      depositInterval: _intervals[0],
      tuneInterval: _intervals[1],
      quoteDecimals: decimals
    }])

  }

  const _marketPrice = (_id) => {
    return terms[_id].controlVariable * _debtRatio(_id) / (10 ** metadatas[_id].quoteDecimals);
  }

  const _debtRatio = (_id) => {
    return markets[_id].totalDebt * (10 ** metadatas[_id].quoteDecimals) / baseSupply;
  }

  const currentDebt = (_id) => {

  }

  const debtDecay = (_id) => {
    const meta = metadatas[_id];

    const secondsSince = timestamp - meta.lastDecay

    return markets[_id].totalDebt * secondsSince / meta.length
  }

  const _controlDecay = (_id) => {
    const info = adjustments[_id];
    if (!info.active) return { adjustBy: 0, secondsSince: 0, stillActive: false }

    const secondsSince_ = timestamp - info.lastAdjustment;

    const active_ = secondsSince_ < info.timeToAdjusted;
    const decay_ = active_
      ? info.change * secondsSince_ / info.timeToAdjusted
      : info.change;

    return { adjustBy: decay_, secondsSince: secondsSince_, stillActive: active_ }
  }

  const currentControlVariable = (_id) => {

  }

  const addNote = (_user, payout_, expiry_, _id, _referral) => {
    setNotes([...notes, {
      id: notes.length,
      payout: payout_,
      created: _user,
      matured: expiry_,
      redeemed: 0,
      marketID: _id,
    }])
    setBaseSupply(baseSupply + payout_)
  }

  const redeem = (_id) => {
    if (timestamp > notes[_id].matured) {
      setNotes([...notes].map((item, index) => {
        if (index === _id) {
          return {
            ...notes[_id],
            redeemed: timestamp
          }
        } else {
          return item
        }
      }))
    }
  }


  const handleAddBond = (values) => {
    create(
      values.quoteToken,
      [values.capacity, values.price, values.debtBuffer],
      [values.capacityInQuote, values.fixedTerm],
      [values.vestingLength, values.conclusion],
      [values.depositInterval, values.tuneInterval]
    )
    setIsAddingBond(false)
  };

  const handleDeposit = (values) => {
    deposit(values.id, values.amount, prices[values.id], "xxx", "xxx")
  }

  return (<>
    <div className="bg-gray-50 min-h-screen py-6 text-gray-700">
      <div className="container mx-auto">
        <div className="rounded-xl shadow-xl p-10 my-6 bg-white">
          <div className="flex justify-between items-center">
            <h1 className="text-xl font-medium mb-6">
              Bonds Market ({markets.length})
            </h1>
            <Button type="primary" onClick={() => setIsAddingBond(true)}>
              Add Bond
            </Button>
          </div>
          <div className="mb-6">
            <span className="bg-gray-100 rounded-lg px-4 py-1 mr-2 inline-block">Timestamp: <b>{timestamp}</b></span>
            <span className="bg-gray-100 rounded-lg px-4 py-1 mr-2 inline-block">Base Supply: <b>{baseSupply}</b></span>
          </div>
          {markets.length === 0
            ? <div className="p-10 rounded-xl border mb-6 text-center font-medium text-xl">No Bond</div>
            : markets.map((market, i) =>
              <div index={i} className="p-10 rounded-xl border grid grid-cols-4 gap-2 mb-6">
                <div className="mb-6 col-span-4">
                  <span className="bg-gray-100 rounded-lg px-4 py-1 mr-2 inline-block">Next Turn: <b>{metadatas[i] ? metadatas[i].lastTune + metadatas[i].tuneInterval - timestamp : 0}s</b></span>
                </div>
                <div className="col-span-4 font-bold"> quoteToken: <b>{markets[i].quoteToken}</b> </div>
                <div>capacityInQuote: <b>{markets[i].capacityInQuote.toString()}</b> </div>
                <div>capacity: <b>{formatNumber(markets[i].capacity)}
                </b> </div>
                <div>totalDebt: <b>{formatNumber(markets[i].totalDebt)}</b> </div>
                <div>maxPayout: <b>{formatNumber(markets[i].maxPayout)}</b> </div>
                <div>purchased: <b>{formatNumber(markets[i].purchased)}</b> </div>
                <div>sold: <b>{formatNumber(markets[i].sold)}</b> </div>

                {
                  terms[i] && <>
                    <div>fixedTerm: <b>{terms[i].fixedTerm.toString()}</b> </div>
                    <div>controlVariable: <b>{formatNumber(terms[i].controlVariable)}</b> </div>
                    <div>vesting: <b>{formatNumber(terms[i].vesting)}</b> </div>
                    <div>conclusion: <b>{formatNumber(terms[i].conclusion)}</b> </div>
                    <div>maxDebt: <b>{formatNumber(terms[i].maxDebt)}</b> </div>
                  </>
                }

                {
                  metadatas[i] && <>
                    <div>lastTune: <b>{metadatas[i].lastTune}</b> </div>
                    <div>lastDecay: <b>{metadatas[i].lastDecay}</b> </div>
                    <div>length: <b>{metadatas[i].length}</b> </div>
                    <div>depositInterval: <b>{metadatas[i].depositInterval}</b> </div>
                    <div>tuneInterval: <b>{metadatas[i].tuneInterval}</b> </div>
                    <div>quoteDecimals: <b>{formatNumber(metadatas[i].quoteDecimals)}</b> </div>
                    <div>Market Price: <b>{formatNumber(prices[i])}</b></div>
                  </>
                }

                <div className="col-span-4 mt-6">
                  <h2 className="font-bold">Deposit Bond</h2>
                  <Form
                    name="deposit"
                    labelCol={{ span: 24 }}
                    wrapperCol={{ span: 24 }}
                    initialValues={{ capacityInQuote: true, fixedTerm: true }}
                    onFinish={handleDeposit}
                  >
                    <Row gutter={16}>
                      <Col span={4}>
                        <Form.Item label="id" name="id" initialValue={i}>
                          <InputNumber disabled style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item label="amount" name="amount" initialValue={100 * 1e18}>
                          <InputNumber formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={value => value.replace(/\$\s?|(,*)/g, '')} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item label="_">
                          <Button type="primary" htmlType="submit">
                            Deposit
                          </Button>
                        </Form.Item>
                      </Col>
                    </Row>
                  </Form>
                </div>

                <div className="col-span-4 mt-6">
                  <h2 className="font-bold">Your Bond</h2>
                  <table className="table-auto w-full border">
                    <thead>
                      <tr>
                        <th className="p-2 border bg-gray-50 text-left">ID</th>
                        <th className="p-2 border bg-gray-50 text-left">Payout</th>
                        <th className="p-2 border bg-gray-50 text-left">Conclutions</th>
                        <th className="p-2 border bg-gray-50 text-left"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {notes.filter(item => item.marketID === i).map((note, noteID) =>
                        <tr key={noteID}>
                          <td className="p-2 border">{noteID + 1}</td>
                          <td className="p-2 border">{note.payout}</td>
                          <td className="p-2 border">{note.matured > timestamp ? note.matured - timestamp : 0}s</td>
                          <td className="p-2 border text-center">
                            {note.redeemed === 0
                              ? <>
                                {
                                  timestamp > note.matured ? <Button type="primary" onClick={() => redeem(note.id)}>Redeem</Button> : <Button type="primary" disabled>Redeem</Button>
                                }
                              </>
                              : <Button type="primary" disabled>Redeemed</Button>}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
        </div>
      </div>
    </div>


    <Modal title="Create Bond" visible={isAddingBond} onOk={() => form.submit()} onCancel={() => setIsAddingBond(false)} width={1000}>
      <Form
        name="bond"
        labelCol={{ span: 24 }}
        wrapperCol={{ span: 24 }}
        initialValues={initBondData}
        onFinish={handleAddBond}
        form={form}
      >
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item label="quoteToken" name="quoteToken">
              <Input />
            </Form.Item>
          </Col>

          <Col span={8}></Col>

          <Col span={8}>
            <Form.Item label="capacity" name="capacity">
              <InputNumber formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={value => value.replace(/\$\s?|(,*)/g, '')} style={{ width: "100%" }} />
            </Form.Item>
          </Col>

          <Col span={8}>
            <Form.Item label="price" name="price">
              <InputNumber formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={value => value.replace(/\$\s?|(,*)/g, '')} style={{ width: "100%" }} />
            </Form.Item>
          </Col>

          <Col span={8}>
            <Form.Item label="debtBuffer" name="debtBuffer">
              <InputNumber formatter={value => `$ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')} parser={value => value.replace(/\$\s?|(,*)/g, '')} style={{ width: "100%" }} />
            </Form.Item>
          </Col>

          <Col span={8}>
            <Form.Item label="capacityInQuote" name="capacityInQuote" valuePropName="checked">
              <Checkbox />
            </Form.Item>
          </Col>

          <Col span={8}>
            <Form.Item label="fixedTerm" name="fixedTerm" valuePropName="checked">
              <Checkbox />
            </Form.Item>
          </Col>

          <Col span={8}></Col>

          <Col span={8}>
            <Form.Item label="vestingLength" name="vestingLength">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </Col>

          <Col span={8}>
            <Form.Item label="conclusion" name="conclusion">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </Col>

          <Col span={8}></Col>

          <Col span={8}>
            <Form.Item label="depositInterval" name="depositInterval">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </Col>

          <Col span={8}>
            <Form.Item label="tuneInterval" name="tuneInterval">
              <InputNumber style={{ width: "100%" }} />
            </Form.Item>
          </Col>

        </Row>
      </Form>
    </Modal>
  </>);
}

export default App;
